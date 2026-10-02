import { useEffect, useMemo, useState } from "react";
import { useForm, type FieldValues, type Path, type UseFormRegister } from "react-hook-form";
import { Link, useSearch } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Copy,
  Loader2,
  Minus,
  Plus,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Search,
} from "lucide-react";
import {
  getGetSchoolCommerceSettingsQueryKey,
  getListClassFeeSchedulesQueryKey,
  getListStoreProductsQueryKey,
  getLookupIndividualFeeChargeQueryKey,
  useCreateStoreOrder,
  useGetSchoolCommerceSettings,
  useListClassFeeSchedules,
  useListStoreProducts,
  useLookupIndividualFeeCharge,
  useSubmitFeePaymentReport,
} from "@workspace/api-client-react";
import type { FeePaymentReportInput, StoreOrderInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Footer, Navbar } from "@/components/Layout";
import { FeeScheduleOverview } from "@/components/FeeScheduleOverview";
import { StoreProductImage } from "@/components/StoreProductImage";
import { Form } from "@/components/ui/form";
import { trackEvent } from "@/lib/analytics";

type OrderForm = Omit<StoreOrderInput, "items"> & { orderNotes: string; transferReference: string };
type FeeForm = {
  feeType: "class_fee" | "individual_charge";
  scheduleId: string;
  chargeReference: string;
  studentName: string;
  studentIdentifier: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  transferReference: string;
};

const naira = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(kobo / 100);

function Field<T extends FieldValues>({ label, name, type = "text", register, required = true, placeholder }: {
  label: string;
  name: Path<T>;
  type?: string;
  register: UseFormRegister<T>;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-semibold text-foreground">
      {label}{required && <span className="text-destructive"> *</span>}
      <input type={type} placeholder={placeholder} data-testid={`input-${name}`} {...register(name, { required: required ? `${label} is required.` : false })} className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" />
    </label>
  );
}

export default function SchoolCommerce() {
  const queryClient = useQueryClient();
  const search = useSearch();
  const requestedSection = new URLSearchParams(search).get("section");
  const [section, setSection] = useState<"shop" | "fees">(
    requestedSection === "fees" ? "fees" : "shop",
  );
  useEffect(() => {
    if (requestedSection === "fees" || requestedSection === "shop") {
      setSection(requestedSection);
    }
  }, [requestedSection]);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [orderReceipt, setOrderReceipt] = useState<{ reference: string; totalKobo: number } | null>(null);
  const [feeReceipt, setFeeReceipt] = useState<{ reference: string; amountKobo: number } | null>(null);
  const [lookupReference, setLookupReference] = useState("");

  const productsQuery = useListStoreProducts({ query: { queryKey: getListStoreProductsQueryKey() } });
  const schedulesQuery = useListClassFeeSchedules({ query: { queryKey: getListClassFeeSchedulesQueryKey() } });
  const settingsQuery = useGetSchoolCommerceSettings({ query: { queryKey: getGetSchoolCommerceSettingsQueryKey() } });
  const lookupQuery = useLookupIndividualFeeCharge(lookupReference.trim(), {
    query: { enabled: !!lookupReference.trim(), queryKey: getLookupIndividualFeeChargeQueryKey(lookupReference.trim()) },
  });
  const createOrder = useCreateStoreOrder();
  const submitReport = useSubmitFeePaymentReport();
  const orderForm = useForm<OrderForm>({
    defaultValues: { guardianName: "", guardianEmail: "", guardianPhone: "", studentName: "", studentClass: "", orderNotes: "", transferReference: "" },
  });
  const feeForm = useForm<FeeForm>({
    defaultValues: { feeType: "class_fee", scheduleId: "", chargeReference: "", studentName: "", studentIdentifier: "", guardianName: "", guardianEmail: "", guardianPhone: "", transferReference: "" },
  });

  const products = useMemo(
    () => [...(productsQuery.data ?? [])].sort(
      (a, b) => Number(b.category === "uniform") - Number(a.category === "uniform"),
    ),
    [productsQuery.data],
  );
  const schedules = schedulesQuery.data ?? [];
  const cartItems = useMemo(() => products.filter((product) => cart[product.id]).map((product) => ({ product, quantity: cart[product.id] })), [products, cart]);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.product.priceKobo * item.quantity, 0);
  const setQuantity = (id: number, quantity: number) => setCart((current) => {
    const next = { ...current };
    if (quantity <= 0) delete next[id]; else next[id] = Math.min(quantity, 20);
    return next;
  });

  const onOrderSubmit = orderForm.handleSubmit(async (values) => {
    if (!cartItems.length) {
      orderForm.setError("root", { message: "Add at least one item before sending an order request." });
      return;
    }
    setOrderReceipt(null);
    const payload: StoreOrderInput = {
      guardianName: values.guardianName.trim(),
      guardianEmail: values.guardianEmail.trim(),
      guardianPhone: values.guardianPhone.trim(),
      studentName: values.studentName.trim(),
      studentClass: values.studentClass.trim(),
      items: cartItems.map(({ product, quantity }) => ({ productId: product.id, quantity })),
      orderNotes: values.orderNotes.trim() || undefined,
      transferReference: values.transferReference.trim() || undefined,
    };
    const receipt = await createOrder.mutateAsync({ data: payload });
    trackEvent("school_order_request_submitted", { product_count: payload.items.length });
    setOrderReceipt({ reference: receipt.reference, totalKobo: receipt.totalKobo });
    setCart({});
    orderForm.reset();
    await queryClient.invalidateQueries({ queryKey: getListStoreProductsQueryKey() });
  });

  const onFeeSubmit = feeForm.handleSubmit(async (values) => {
    setFeeReceipt(null);
    const payload: FeePaymentReportInput = {
      feeType: values.feeType,
      ...(values.feeType === "class_fee" ? { scheduleId: Number(values.scheduleId) } : { chargeReference: values.chargeReference.trim() }),
      studentName: values.studentName.trim(),
      studentIdentifier: values.studentIdentifier.trim(),
      guardianName: values.guardianName.trim(),
      guardianEmail: values.guardianEmail.trim(),
      guardianPhone: values.guardianPhone.trim(),
      transferReference: values.transferReference.trim() || undefined,
    };
    const receipt = await submitReport.mutateAsync({ data: payload });
    trackEvent("school_fee_report_submitted", {
      fee_type: values.feeType,
      transfer_reference_provided: Boolean(values.transferReference.trim()),
    });
    setFeeReceipt({ reference: receipt.reference, amountKobo: receipt.amountKobo });
    feeForm.reset({ ...feeForm.getValues(), studentName: "", studentIdentifier: "", transferReference: "" });
  });

  const individualLookup = lookupQuery.data;
  const formatQueryError = (query: { error: unknown }) => query.error instanceof Error ? query.error.message : "We could not load this information.";

  return (
    <div className="min-h-screen bg-background">
      <Navbar solid />
      <main className="pt-28">
        <section className="border-b border-border bg-secondary text-secondary-foreground">
          <div className="container mx-auto grid gap-10 px-4 py-16 md:grid-cols-[1.1fr_0.9fr] md:px-8 md:py-24">
            <div>
              <Link href="/" data-testid="link-commerce-home" className="mb-7 inline-flex items-center gap-2 text-sm text-white/70 hover:text-accent"><ArrowLeft size={15} /> Return to school website</Link>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-accent">Parent services</p>
              <h1 className="max-w-3xl font-serif text-4xl font-bold leading-tight md:text-6xl">School fees, uniforms & materials.</h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/70 md:text-lg">Request uniforms and learning materials, or tell the School Office about an offline fee transfer. Every request is linked to the student details you provide and confirmed manually by staff.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button type="button" onClick={() => setSection("shop")} data-testid="button-commerce-shop-tab" className={`rounded-full px-5 py-3 text-sm font-bold transition ${section === "shop" ? "bg-accent text-secondary" : "border border-white/20 text-white hover:border-accent hover:text-accent"}`}><ShoppingBag size={16} className="mr-2 inline" /> School store</button>
                <button type="button" onClick={() => setSection("fees")} data-testid="button-commerce-fees-tab" className={`rounded-full px-5 py-3 text-sm font-bold transition ${section === "fees" ? "bg-accent text-secondary" : "border border-white/20 text-white hover:border-accent hover:text-accent"}`}><Receipt size={16} className="mr-2 inline" /> Fee desk</button>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-6 backdrop-blur-sm md:p-8">
              <ShieldCheck className="mb-5 text-accent" size={29} />
              <h2 className="font-serif text-2xl font-bold">Confirmed by the School Office</h2>
              <p className="mt-3 text-sm leading-relaxed text-white/65">The School Office will contact you to confirm availability, delivery or collection details, and any offline payment report. No payment is processed on this page.</p>
              <div className="mt-6 grid gap-3 text-sm text-white/80">
                <div className="flex gap-3"><span className="font-mono text-accent">01</span><span>Choose an active item or fee schedule.</span></div>
                <div className="flex gap-3"><span className="font-mono text-accent">02</span><span>Send the request with accurate student details.</span></div>
                <div className="flex gap-3"><span className="font-mono text-accent">03</span><span>Keep the School Office reference for follow-up.</span></div>
              </div>
            </div>
          </div>
        </section>

        <div className="container mx-auto px-4 py-12 md:px-8 md:py-16">
          {(products.some((product) => product.description.startsWith("DEMO:")) || schedules.some((schedule) => schedule.description.startsWith("DEMO:"))) && (
            <aside className="mb-8 rounded-2xl border border-accent/40 bg-accent/10 p-5" data-testid="notice-demo-prices">
              <p className="font-semibold text-secondary">Demo prices — for preview only</p>
              <p className="mt-1 text-sm leading-relaxed text-foreground/75">Demo-labelled products and fee schedules use sample prices and stock. Do not make payments against these demo amounts. Confirm official prices with the School Office.</p>
            </aside>
          )}
          {section === "fees" && <FeeScheduleOverview schedules={schedules} formatAmount={naira} />}
          {settingsQuery.data?.paymentInstructions?.trim() && (
            <section className="mb-10 rounded-2xl border border-accent/30 bg-accent/10 p-5" data-testid="panel-payment-instructions">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">School Office payment instructions</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground" data-testid="text-payment-instructions">{settingsQuery.data.paymentInstructions}</p>
            </section>
          )}
          {section === "shop" ? (
            <div className="grid gap-10 xl:grid-cols-[1.15fr_0.85fr]">
              <section>
                <div className="mb-6 flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Available now</p><h2 className="mt-2 font-serif text-3xl font-bold">School store</h2></div><span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary" data-testid="text-product-count">{products.length} active items</span></div>
                {productsQuery.isLoading ? <div className="grid gap-4 sm:grid-cols-2">{[1, 2, 3, 4].map((id) => <div key={id} className="h-64 animate-pulse rounded-2xl bg-muted" data-testid={`loading-product-${id}`} />)}</div> : productsQuery.isError ? <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center text-sm text-destructive" data-testid="error-products"><AlertCircle className="mx-auto mb-3" size={24} />{formatQueryError(productsQuery)}<button type="button" onClick={() => void productsQuery.refetch()} data-testid="button-retry-products" className="mt-4 block mx-auto font-bold underline">Try again</button></div> : products.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-12 text-center" data-testid="empty-products"><ShoppingBag className="mx-auto mb-4 text-muted-foreground" size={32} /><h3 className="font-serif text-xl font-bold">The store is being prepared</h3><p className="mt-2 text-sm text-muted-foreground">No school store items are available yet. Please check again after the School Office publishes the catalogue.</p></div> : <div className="grid gap-4 sm:grid-cols-2" data-testid="list-products">{products.map((product) => <article key={product.id} className="overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/30 hover:shadow-md" data-testid={`card-product-${product.id}`}>
                  <StoreProductImage product={product} />
                  <div className="p-5">
                    <h3 className="font-serif text-xl font-bold leading-snug" data-testid={`text-product-title-${product.id}`}>{product.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{product.variant}</p>
                    <p className="mt-3 text-lg font-bold tabular-nums text-primary" data-testid={`text-product-price-${product.id}`}>{naira(product.priceKobo)}</p>
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{product.description}</p>
                    <div className="mt-5 flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-muted-foreground">{product.stock === null ? "Stock checked by office" : product.stock > 0 ? `${product.stock} available` : "Currently unavailable"}</span>
                      <div className="flex items-center gap-2 rounded-xl border border-border p-1">
                        <button type="button" onClick={() => setQuantity(product.id, (cart[product.id] ?? 0) - 1)} disabled={!cart[product.id]} data-testid={`button-decrease-product-${product.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-40" aria-label={`Remove one ${product.title}`}><Minus size={15} /></button>
                        <span className="min-w-6 text-center text-sm font-bold" data-testid={`text-product-quantity-${product.id}`}>{cart[product.id] ?? 0}</span>
                        <button type="button" onClick={() => setQuantity(product.id, (cart[product.id] ?? 0) + 1)} disabled={product.stock === 0 || (cart[product.id] ?? 0) >= 20 || (product.stock !== null && (cart[product.id] ?? 0) >= product.stock)} data-testid={`button-increase-product-${product.id}`} className="rounded-lg p-2 text-primary hover:bg-primary/10 disabled:opacity-40" aria-label={`Add one ${product.title}`}><Plus size={15} /></button>
                      </div>
                    </div>
                  </div>
                </article>)}</div>}
              </section>
              <section className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8" data-testid="panel-order-request">
                <div className="mb-7 flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Step 2</p><h2 className="mt-2 font-serif text-2xl font-bold">Send an order request</h2><p className="mt-2 text-sm text-muted-foreground">The office will confirm the request before preparing anything.</p></div><ClipboardList className="text-primary" size={24} /></div>
                {cartItems.length > 0 && <div className="mb-6 space-y-2 rounded-2xl bg-muted/60 p-4" data-testid="list-cart-items">{cartItems.map(({ product, quantity }) => <div key={product.id} className="flex justify-between gap-3 text-sm"><span>{product.title} × {quantity}</span><span className="font-semibold">{naira(product.priceKobo * quantity)}</span></div>)}<div className="mt-3 flex justify-between border-t border-border pt-3 font-bold"><span>Request total</span><span className="text-primary" data-testid="text-cart-total">{naira(cartTotal)}</span></div></div>}
                <Form {...orderForm}><form onSubmit={onOrderSubmit} className="space-y-4" data-testid="form-store-order"><Field label="Guardian name" name="guardianName" register={orderForm.register} placeholder="Full name" /><Field label="Guardian email" name="guardianEmail" type="email" register={orderForm.register} placeholder="name@example.com" /><Field label="Guardian phone" name="guardianPhone" type="tel" register={orderForm.register} placeholder="+234" /><div className="grid gap-4 sm:grid-cols-2"><Field label="Student name" name="studentName" register={orderForm.register} /><Field label="Class" name="studentClass" register={orderForm.register} /></div><label className="block text-sm font-semibold">Order notes<span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span><textarea rows={3} {...orderForm.register("orderNotes")} data-testid="input-orderNotes" className="mt-2 w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary" placeholder="Collection timing or sizing note" /></label><Field label="Transfer reference" name="transferReference" register={orderForm.register} required={false} placeholder="Only if you already transferred offline" />{orderForm.formState.errors.root && <p className="text-sm text-destructive" data-testid="error-store-order">{orderForm.formState.errors.root.message}</p>}{createOrder.isError && <p className="text-sm text-destructive" data-testid="error-store-order-api">The request could not be sent. Please try again.</p>}<button type="submit" disabled={createOrder.isPending} data-testid="button-submit-store-order" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{createOrder.isPending ? <Loader2 size={17} className="animate-spin" /> : <ClipboardList size={17} />} {createOrder.isPending ? "Sending request…" : "Send order request"}</button></form></Form>
                {orderReceipt && <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm" role="status" data-testid="success-store-order"><CheckCircle2 className="mb-2 text-primary" size={20} /><p className="font-bold">Request received. No payment has been processed.</p><p className="mt-1 text-muted-foreground">School Office reference: <strong className="font-mono text-foreground" data-testid="text-order-reference">{orderReceipt.reference}</strong></p><p className="mt-1 text-muted-foreground">Recorded total: {naira(orderReceipt.totalKobo)}</p></div>}
              </section>
            </div>
          ) : (
            <div className="grid gap-10 xl:grid-cols-[0.9fr_1.1fr]">
              <section className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8"><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">School Office reference</p><h2 className="mt-2 font-serif text-3xl font-bold">Find an individual charge</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Enter the unguessable reference issued privately by the School Office. This lookup does not reveal student names or identifiers.</p><div className="mt-6 flex gap-2"><input value={lookupReference} onChange={(e) => setLookupReference(e.target.value)} data-testid="input-charge-lookup-reference" placeholder="e.g. NWES-…" className="min-w-0 flex-1 rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary" /><button type="button" onClick={() => setLookupReference(lookupReference.trim())} data-testid="button-lookup-charge" className="rounded-xl bg-secondary px-4 py-3 text-sm font-bold text-white hover:bg-secondary/90"><Search size={17} /></button></div>{lookupQuery.isFetching && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" data-testid="loading-charge-lookup"><Loader2 className="animate-spin" size={15} /> Looking up reference…</p>}{lookupQuery.isError && <p className="mt-4 text-sm text-destructive" data-testid="error-charge-lookup">That reference could not be found. Check it with the School Office.</p>}{individualLookup && <div className="mt-5 rounded-2xl bg-muted/60 p-5" data-testid="card-charge-lookup"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reference found</p><h3 className="mt-2 font-serif text-xl font-bold">{individualLookup.description}</h3><p className="mt-1 text-sm text-muted-foreground">{individualLookup.className} · {individualLookup.term} · {individualLookup.academicYear}</p><p className="mt-4 text-2xl font-bold text-primary">{naira(individualLookup.amountKobo)}</p><p className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{individualLookup.status === "due" ? "Awaiting offline payment" : individualLookup.status}</p></div>}<div className="mt-8 border-t border-border pt-6"><p className="text-sm font-semibold">Class fee schedules</p>{schedulesQuery.isLoading ? <div className="mt-3 h-16 animate-pulse rounded-xl bg-muted" data-testid="loading-fee-schedules" /> : schedules.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="empty-fee-schedules">No active class fee schedules have been published.</p> : <div className="mt-3 space-y-2" data-testid="list-fee-schedules">{schedules.map((schedule) => <div key={schedule.id} className="flex justify-between gap-3 rounded-xl border border-border p-3 text-sm" data-testid={`row-fee-schedule-${schedule.id}`}><span>{schedule.className} · {schedule.term}<small className="block text-muted-foreground">{schedule.description}</small></span><strong className="text-primary">{naira(schedule.amountKobo)}</strong></div>)}</div>}</div></section>
              <section className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8"><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Offline payment report</p><h2 className="mt-2 font-serif text-3xl font-bold">Tell the office about a transfer</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Submitting this form records a request for School Office review. It does not confirm payment.</p><Form {...feeForm}><form onSubmit={onFeeSubmit} className="mt-7 space-y-4" data-testid="form-fee-report"><label className="block text-sm font-semibold">Fee type<select {...feeForm.register("feeType")} data-testid="select-fee-type" className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm"><option value="class_fee">Class / term fee</option><option value="individual_charge">Individual charge</option></select></label>{feeForm.watch("feeType") === "class_fee" ? <label className="block text-sm font-semibold">Class fee schedule<select {...feeForm.register("scheduleId", { required: "Choose a fee schedule." })} data-testid="select-fee-schedule" className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm"><option value="">Select a published schedule</option>{schedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.className} · {schedule.term} · {naira(schedule.amountKobo)}</option>)}</select></label> : <Field label="School Office charge reference" name="chargeReference" register={feeForm.register} placeholder="Paste the private reference" />}<div className="grid gap-4 sm:grid-cols-2"><Field label="Student name" name="studentName" register={feeForm.register} /><Field label="Student identifier" name="studentIdentifier" register={feeForm.register} placeholder="Admission or school ID" /></div><Field label="Guardian name" name="guardianName" register={feeForm.register} /><div className="grid gap-4 sm:grid-cols-2"><Field label="Guardian email" name="guardianEmail" type="email" register={feeForm.register} /><Field label="Guardian phone" name="guardianPhone" type="tel" register={feeForm.register} /></div><Field label="Transfer reference" name="transferReference" register={feeForm.register} required={false} placeholder="Bank transfer reference, if available" />{submitReport.isError && <p className="text-sm text-destructive" data-testid="error-fee-report">The report could not be sent. Check the details and try again.</p>}<button type="submit" disabled={submitReport.isPending} data-testid="button-submit-fee-report" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{submitReport.isPending ? <Loader2 className="animate-spin" size={17} /> : <Receipt size={17} />} {submitReport.isPending ? "Sending report…" : "Send payment report"}</button></form></Form>{feeReceipt && <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm" role="status" data-testid="success-fee-report"><CheckCircle2 className="mb-2 text-primary" size={20} /><p className="font-bold">Report received for School Office review.</p><p className="mt-1 text-muted-foreground">Report reference: <strong className="font-mono text-foreground" data-testid="text-fee-report-reference">{feeReceipt.reference}</strong></p><p className="mt-1 text-muted-foreground">Amount recorded: {naira(feeReceipt.amountKobo)}</p></div>}</section>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}