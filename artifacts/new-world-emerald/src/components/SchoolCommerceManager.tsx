import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  Clipboard,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Save,
  Settings2,
  Store,
  Trash2,
  WalletCards,
} from "lucide-react";
import {
  getGetSchoolCommerceSettingsQueryKey,
  getListClassFeeSchedulesQueryKey,
  getListIndividualFeeChargesQueryKey,
  getListManagedClassFeeSchedulesQueryKey,
  getListManagedStoreProductsQueryKey,
  getListFeePaymentReportsQueryKey,
  getListStoreOrdersQueryKey,
  getListStoreProductsQueryKey,
  useCreateClassFeeSchedule,
  useCreateIndividualFeeCharge,
  useCreateStoreProduct,
  useDeleteClassFeeSchedule,
  useDeleteIndividualFeeCharge,
  useDeleteStoreProduct,
  useGetSchoolCommerceSettings,
  useListFeePaymentReports,
  useListIndividualFeeCharges,
  useListManagedClassFeeSchedules,
  useListManagedStoreProducts,
  useListStoreOrders,
  useUpdateClassFeeSchedule,
  useUpdateFeePaymentReport,
  useUpdateIndividualFeeCharge,
  useUpdateSchoolCommerceSettings,
  useUpdateStoreOrder,
  useUpdateStoreProduct,
} from "@workspace/api-client-react";
import type { ClassFeeScheduleInput, IndividualFeeChargeInput, StoreProductInput } from "@workspace/api-client-react";
import { Form } from "@/components/ui/form";
import { trackEvent } from "@/lib/analytics";
import { ProductPhotoUpload } from "@/components/ProductPhotoUpload";

const money = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(kobo / 100);
const kobo = (naira: string) => Math.round(Number(naira) * 100);
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const categories = ["uniform", "books", "supplies", "other"] as const;
const orderStatuses = ["new", "contacted", "preparing", "ready", "completed", "cancelled"] as const;
const paymentStatuses = ["awaiting_payment", "reported", "confirmed", "rejected"] as const;
const reportStatuses = ["payment_requested", "reported", "confirmed", "rejected"] as const;
const panels = [
  ["catalogue", "Store items", Store],
  ["fees", "Fees", WalletCards],
  ["orders", "Orders", Clipboard],
  ["reports", "Reports", FileText],
  ["settings", "Instructions", Settings2],
] as const;

type ProductForm = { title: string; description: string; category: StoreProductInput["category"]; variant: string; price: string; stock: string; imageUrl: string; isActive: boolean };
const blankProduct: ProductForm = { title: "", description: "", category: "uniform", variant: "", price: "", stock: "", imageUrl: "", isActive: true };
type ScheduleForm = { className: string; term: string; academicYear: string; amount: string; description: string; isActive: boolean };
type ChargeForm = { studentName: string; studentIdentifier: string; className: string; term: string; academicYear: string; description: string; amount: string };

function TextInput({ label: fieldLabel, name, register, type = "text", required = true, placeholder }: { label: string; name: string; register: any; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="block text-sm font-semibold">{fieldLabel}{required && <span className="text-destructive"> *</span>}<input type={type} placeholder={placeholder} data-testid={`input-${name}`} {...register(name, { required: required ? `${fieldLabel} is required.` : false })} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>;
}

function LoadingRows({ name }: { name: string }) {
  return <div className="space-y-3" data-testid={`loading-${name}`}>{[1, 2, 3].map((id) => <div key={id} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>;
}

export function SchoolCommerceManager() {
  const queryClient = useQueryClient();
  const [activePanel, setActivePanel] = useState<"store-items" | "fees" | "orders" | "reports" | "settings">("store-items");
  const [editingProduct, setEditingProduct] = useState<number | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<number | null>(null);
  const [editingCharge, setEditingCharge] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [copiedReference, setCopiedReference] = useState("");

  const productsQuery = useListManagedStoreProducts();
  const schedulesQuery = useListManagedClassFeeSchedules();
  const chargesQuery = useListIndividualFeeCharges();
  const ordersQuery = useListStoreOrders();
  const reportsQuery = useListFeePaymentReports();
  const settingsQuery = useGetSchoolCommerceSettings();
  const createProduct = useCreateStoreProduct();
  const updateProduct = useUpdateStoreProduct();
  const deleteProduct = useDeleteStoreProduct();
  const createSchedule = useCreateClassFeeSchedule();
  const updateSchedule = useUpdateClassFeeSchedule();
  const deleteSchedule = useDeleteClassFeeSchedule();
  const createCharge = useCreateIndividualFeeCharge();
  const updateCharge = useUpdateIndividualFeeCharge();
  const deleteCharge = useDeleteIndividualFeeCharge();
  const updateOrder = useUpdateStoreOrder();
  const updateReport = useUpdateFeePaymentReport();
  const updateSettings = useUpdateSchoolCommerceSettings();

  const productForm = useForm<ProductForm>({ defaultValues: { ...blankProduct } });
  const scheduleForm = useForm<ScheduleForm>({ defaultValues: { className: "", term: "", academicYear: "", amount: "", description: "", isActive: true } });
  const chargeForm = useForm<ChargeForm>({ defaultValues: { studentName: "", studentIdentifier: "", className: "", term: "", academicYear: "", description: "", amount: "" } });
  const settingsForm = useForm<{ paymentInstructions: string }>({ defaultValues: { paymentInstructions: "" } });
  productForm.register("imageUrl");
  const productFormLocked = photoUploading || createProduct.isPending || updateProduct.isPending;

  const run = async (task: () => Promise<unknown>, success: string, invalidate: string[]): Promise<boolean> => {
    setActionError(""); setMessage("");
    try {
      await task();
      setMessage(success);
      await Promise.all(invalidate.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The School Office action could not be completed.");
      return false;
    }
  };
  const invalidate = {
    products: [getListManagedStoreProductsQueryKey()[0], getListStoreProductsQueryKey()[0]],
    schedules: [getListManagedClassFeeSchedulesQueryKey()[0], getListClassFeeSchedulesQueryKey()[0]],
    charges: [getListIndividualFeeChargesQueryKey()[0]],
    orders: [getListStoreOrdersQueryKey()[0]],
    reports: [getListFeePaymentReportsQueryKey()[0]],
    settings: [getGetSchoolCommerceSettingsQueryKey()[0]],
  };

  const submitProduct = productForm.handleSubmit((values) => {
    if (photoUploading) return;
    return run(
      () => editingProduct
        ? updateProduct.mutateAsync({ id: editingProduct, data: { title: values.title.trim(), description: values.description.trim(), category: values.category, variant: values.variant.trim(), priceKobo: kobo(values.price), stock: values.stock.trim() === "" ? null : Number(values.stock), imageUrl: values.imageUrl.trim() || null, isActive: values.isActive } })
        : createProduct.mutateAsync({ data: { title: values.title.trim(), description: values.description.trim(), category: values.category, variant: values.variant.trim(), priceKobo: kobo(values.price), stock: values.stock.trim() === "" ? null : Number(values.stock), imageUrl: values.imageUrl.trim() || null, isActive: values.isActive } }),
      editingProduct ? "Product changes saved." : "Product added to the catalogue.",
      invalidate.products,
    ).then((succeeded) => {
      if (!succeeded) return;
      setEditingProduct(null);
      productForm.reset({ ...blankProduct });
    });
  });
  const submitSchedule = scheduleForm.handleSubmit((values) => run(
    () => editingSchedule ? updateSchedule.mutateAsync({ id: editingSchedule, data: { className: values.className.trim(), term: values.term.trim(), academicYear: values.academicYear.trim(), amountKobo: kobo(values.amount), description: values.description.trim(), isActive: values.isActive } }) : createSchedule.mutateAsync({ data: { className: values.className.trim(), term: values.term.trim(), academicYear: values.academicYear.trim(), amountKobo: kobo(values.amount), description: values.description.trim(), isActive: values.isActive } }),
    editingSchedule ? "Fee schedule updated." : "Fee schedule published.",
    invalidate.schedules,
  ).then(() => { setEditingSchedule(null); scheduleForm.reset(); }));
  const submitCharge = chargeForm.handleSubmit((values) => run(
    () => editingCharge ? updateCharge.mutateAsync({ id: editingCharge, data: { studentName: values.studentName.trim(), studentIdentifier: values.studentIdentifier.trim(), className: values.className.trim(), term: values.term.trim(), academicYear: values.academicYear.trim(), description: values.description.trim(), amountKobo: kobo(values.amount) } }) : createCharge.mutateAsync({ data: { studentName: values.studentName.trim(), studentIdentifier: values.studentIdentifier.trim(), className: values.className.trim(), term: values.term.trim(), academicYear: values.academicYear.trim(), description: values.description.trim(), amountKobo: kobo(values.amount) } }),
    editingCharge ? "Individual charge updated." : "Individual charge issued.",
    invalidate.charges,
  ).then(() => { setEditingCharge(null); chargeForm.reset(); }));

  const editProduct = (product: NonNullable<typeof productsQuery.data>[number]) => { if (photoUploading) return; setEditingProduct(product.id); productForm.reset({ title: product.title, description: product.description, category: product.category, variant: product.variant, price: (product.priceKobo / 100).toFixed(2), stock: product.stock === null ? "" : String(product.stock), imageUrl: product.imageUrl ?? "", isActive: product.isActive }); setActivePanel("store-items"); };
  const editSchedule = (schedule: NonNullable<typeof schedulesQuery.data>[number]) => { setEditingSchedule(schedule.id); scheduleForm.reset({ className: schedule.className, term: schedule.term, academicYear: schedule.academicYear, amount: (schedule.amountKobo / 100).toFixed(2), description: schedule.description, isActive: schedule.isActive }); setActivePanel("fees"); };
  const editCharge = (charge: NonNullable<typeof chargesQuery.data>[number]) => { setEditingCharge(charge.id); chargeForm.reset({ studentName: charge.studentName, studentIdentifier: charge.studentIdentifier, className: charge.className, term: charge.term, academicYear: charge.academicYear, description: charge.description, amount: (charge.amountKobo / 100).toFixed(2) }); setActivePanel("fees"); };
  const remove = (what: string, task: () => Promise<unknown>, keys: string[]) => { if (window.confirm(`Remove this ${what}?`)) void run(task, `${what} removed.`, keys); };
  const copyReference = async (reference: string) => { await navigator.clipboard?.writeText(reference); setCopiedReference(reference); window.setTimeout(() => setCopiedReference(""), 1800); };

  const updateOrderField = (
    id: number,
    data: { orderStatus?: typeof orderStatuses[number]; paymentStatus?: typeof paymentStatuses[number]; officeNote?: string | null },
  ) => void run(async () => {
    await updateOrder.mutateAsync({ id, data });
    if (data.paymentStatus === "confirmed" || data.paymentStatus === "rejected") {
      trackEvent("school_order_payment_reviewed", { status: data.paymentStatus });
    }
  }, "Order record updated.", invalidate.orders);
  const updateReportField = (
    id: number,
    data: { status?: typeof reportStatuses[number]; officeNote?: string | null },
    feeType?: string,
  ) => {
    const reportFeeType = feeType ?? reportsQuery.data?.find((report) => report.id === id)?.feeType;
    void run(async () => {
      await updateReport.mutateAsync({ id, data });
      if (data.status === "confirmed" || data.status === "rejected") {
        trackEvent("school_fee_payment_reviewed", {
          status: data.status,
          ...(reportFeeType ? { fee_type: reportFeeType } : {}),
        });
      }
    }, "Payment report updated.", invalidate.reports);
  };

  return <section id="school-store" className="scroll-mt-6 rounded-3xl border border-border bg-card shadow-sm" data-testid="school-commerce-manager">
    <div className="border-b border-border p-6 md:p-8">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">Commerce desk</p>
          <h2 className="font-serif text-3xl font-bold">School store and fee records</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Manage what families can request publicly. Orders and payment reports remain offline records until the School Office confirms them.</p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-primary" data-testid="homepage-commerce-admin-help">Homepage uniforms and fees update from these records. Use Store items to edit product photos, sizes and prices, and Fees to edit class, term and amount. Turn off “Visible to families” to hide an item. Replace demo records with official information when ready.</p>
        </div>
        <div className="flex max-w-full flex-wrap rounded-xl border border-border bg-muted/40 p-1" data-testid="commerce-manager-tabs">
          {panels.map(([value, text, Icon]) => (
            <button key={value} type="button" disabled={photoUploading} onClick={() => setActivePanel(value === "catalogue" ? "store-items" : value)} data-testid={`button-commerce-manager-${value}`} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${activePanel === (value === "catalogue" ? "store-items" : value) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon size={14} /> {text}
            </button>
          ))}
        </div>
      </div>
    </div>
    {(message || actionError) && <div className={`mx-6 mt-6 rounded-xl p-4 text-sm ${actionError ? "bg-destructive/5 text-destructive" : "bg-primary/5 text-primary"}`} role={actionError ? "alert" : "status"} data-testid={actionError ? "error-commerce-manager" : "success-commerce-manager"}>{actionError ? <AlertCircle className="mr-2 inline" size={16} /> : <Check className="mr-2 inline" size={16} />}{actionError || message}</div>}
    <div className="p-6 md:p-8">
      {activePanel === "fees" && (
        <p className="mb-6 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm leading-6" data-testid="fee-guide-admin-help">
          Edit the annual overview amounts in <a href="#website-content" className="font-semibold text-primary underline">Website content → Reported fee guide</a>. The forms below manage confirmed class and term charges. Sample schedules remain hidden from families until their demo descriptions are replaced with official details.
        </p>
      )}
      {activePanel === "store-items" && <div className="grid gap-8 xl:grid-cols-[0.85fr_1.15fr]">
        <Form {...productForm}>
          <form onSubmit={submitProduct} className="rounded-2xl border border-border bg-muted/20 p-5" data-testid="form-manage-product">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-serif text-2xl font-bold">{editingProduct ? "Edit product" : "Add a product"}</h3>
                <p className="mt-1 text-xs text-muted-foreground">Enter prices in naira; the catalogue stores kobo.</p>
              </div>
              {editingProduct && <button type="button" disabled={productFormLocked} onClick={() => { setEditingProduct(null); productForm.reset({ ...blankProduct }); }} data-testid="button-cancel-edit-product" className="text-xs font-bold text-muted-foreground underline disabled:opacity-50">Cancel</button>}
            </div>
            <fieldset disabled={photoUploading} className="space-y-4">
              <TextInput label="Title" name="title" register={productForm.register} />
              <TextInput label="Description" name="description" register={productForm.register} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Category
                  <select {...productForm.register("category")} data-testid="select-product-category" className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
                    {categories.map((category) => <option key={category} value={category}>{label(category)}</option>)}
                  </select>
                </label>
                <TextInput label="Variant" name="variant" register={productForm.register} placeholder="Size, edition, or pack" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput label="Price (NGN)" name="price" type="number" register={productForm.register} />
                <TextInput label="Stock" name="stock" type="number" register={productForm.register} required={false} placeholder="Leave blank if office checks" />
              </div>
              <ProductPhotoUpload productKey={editingProduct ?? "new-product"} value={productForm.watch("imageUrl") ?? ""} onChange={(value) => productForm.setValue("imageUrl", value, { shouldDirty: true })} disabled={productFormLocked} onUploadingChange={setPhotoUploading} />
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input type="checkbox" {...productForm.register("isActive")} data-testid="input-product-active" className="h-4 w-4 accent-primary" />
                Visible to families
              </label>
              <button type="submit" disabled={productFormLocked} data-testid="button-save-product" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
                {createProduct.isPending || updateProduct.isPending ? <Loader2 className="animate-spin" size={16} /> : editingProduct ? <Save size={16} /> : <Plus size={16} />}
                {createProduct.isPending || updateProduct.isPending ? "Saving…" : editingProduct ? "Save product" : "Add product"}
              </button>
            </fieldset>
          </form>
        </Form>
        <div>
          <h3 className="mb-4 font-serif text-2xl font-bold">Store items <span className="font-sans text-sm font-semibold text-muted-foreground">({productsQuery.data?.length ?? 0})</span></h3>
          {productsQuery.isLoading ? <LoadingRows name="managed-products" /> : productsQuery.isError
            ? <p className="text-sm text-destructive" data-testid="error-managed-products">Products could not be loaded.</p>
            : (productsQuery.data ?? []).length === 0
              ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="empty-managed-products">No store items yet. Add the first uniform or school supply when ready.</p>
              : <div className="space-y-3" data-testid="list-managed-products">
                {productsQuery.data?.map((product) => <article key={product.id} className="flex flex-col justify-between gap-4 rounded-2xl border border-border p-4 sm:flex-row sm:items-center" data-testid={`row-managed-product-${product.id}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/50">
                      {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-contain" /> : <Store size={20} className="text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-serif text-lg font-bold" data-testid={`text-managed-product-title-${product.id}`}>{product.title}</h4>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${product.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`} data-testid={`status-product-${product.id}`}>{product.isActive ? "Public" : "Hidden"}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{product.variant} · {money(product.priceKobo)} · {product.stock === null ? "Office stock check" : `${product.stock} in stock`}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={photoUploading} onClick={() => editProduct(product)} data-testid={`button-edit-product-${product.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:border-primary/30 hover:text-primary disabled:opacity-50"><Pencil size={14} /> Edit</button>
                    <button type="button" disabled={photoUploading} onClick={() => remove("product", () => deleteProduct.mutateAsync({ id: product.id }), invalidate.products)} data-testid={`button-delete-product-${product.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/20 px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/5 disabled:opacity-50"><Trash2 size={14} /> Remove</button>
                  </div>
                </article>)}
              </div>}
        </div>
      </div>}
      {activePanel === "fees" && <div className="space-y-10"><div className="grid gap-8 xl:grid-cols-2"><Form {...scheduleForm}><form onSubmit={submitSchedule} className="rounded-2xl border border-border bg-muted/20 p-5" data-testid="form-manage-schedule"><div className="mb-5 flex items-center justify-between"><div><h3 className="font-serif text-2xl font-bold">{editingSchedule ? "Edit fee schedule" : "Publish class fee"}</h3><p className="mt-1 text-xs text-muted-foreground">This is the public class / term schedule.</p></div>{editingSchedule && <button type="button" onClick={() => { setEditingSchedule(null); scheduleForm.reset(); }} data-testid="button-cancel-edit-schedule" className="text-xs font-bold text-muted-foreground underline">Cancel</button>}</div><div className="grid gap-4 sm:grid-cols-2"><TextInput label="Class" name="className" register={scheduleForm.register} /><TextInput label="Term" name="term" register={scheduleForm.register} /><TextInput label="Academic year" name="academicYear" register={scheduleForm.register} /><TextInput label="Amount (NGN)" name="amount" type="number" register={scheduleForm.register} /></div><label className="mt-4 block text-sm font-semibold">Description<textarea {...scheduleForm.register("description")} data-testid="input-schedule-description" rows={3} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" /></label><label className="mt-4 flex items-center gap-3 text-sm font-semibold"><input type="checkbox" {...scheduleForm.register("isActive")} data-testid="input-schedule-active" className="h-4 w-4 accent-primary" />Visible to families</label><button type="submit" data-testid="button-save-schedule" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground"><Save size={16} />{editingSchedule ? "Save schedule" : "Publish schedule"}</button></form></Form><div><h3 className="mb-4 font-serif text-2xl font-bold">Class fee schedules</h3>{schedulesQuery.isLoading ? <LoadingRows name="managed-schedules" /> : <div className="space-y-3" data-testid="list-managed-schedules">{(schedulesQuery.data ?? []).map((schedule) => <article key={schedule.id} className="flex flex-col justify-between gap-4 rounded-2xl border border-border p-4 sm:flex-row sm:items-center" data-testid={`row-managed-schedule-${schedule.id}`}><div><h4 className="font-serif text-lg font-bold">{schedule.className} · {schedule.term}</h4><p className="text-sm text-muted-foreground">{schedule.academicYear} · {money(schedule.amountKobo)} · {schedule.isActive ? "Public" : "Hidden"}</p></div><div className="flex gap-2"><button type="button" onClick={() => editSchedule(schedule)} data-testid={`button-edit-schedule-${schedule.id}`} className="rounded-lg border border-border p-2 hover:text-primary"><Pencil size={15} /></button><button type="button" onClick={() => remove("fee schedule", () => deleteSchedule.mutateAsync({ id: schedule.id }), invalidate.schedules)} data-testid={`button-delete-schedule-${schedule.id}`} className="rounded-lg border border-destructive/20 p-2 text-destructive"><Trash2 size={15} /></button></div></article>)}</div>}</div></div><div className="border-t border-border pt-10"><div className="grid gap-8 xl:grid-cols-[0.85fr_1.15fr]"><Form {...chargeForm}><form onSubmit={submitCharge} className="rounded-2xl border border-border bg-muted/20 p-5" data-testid="form-manage-charge"><div className="mb-5 flex items-center justify-between"><div><h3 className="font-serif text-2xl font-bold">{editingCharge ? "Edit individual charge" : "Issue private charge"}</h3><p className="mt-1 text-xs text-muted-foreground">The generated reference is the only public lookup path.</p></div>{editingCharge && <button type="button" onClick={() => { setEditingCharge(null); chargeForm.reset(); }} data-testid="button-cancel-edit-charge" className="text-xs font-bold text-muted-foreground underline">Cancel</button>}</div><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><TextInput label="Student name" name="studentName" register={chargeForm.register} /><TextInput label="Student identifier" name="studentIdentifier" register={chargeForm.register} /><TextInput label="Class" name="className" register={chargeForm.register} /><TextInput label="Term" name="term" register={chargeForm.register} /><TextInput label="Academic year" name="academicYear" register={chargeForm.register} /><TextInput label="Amount (NGN)" name="amount" type="number" register={chargeForm.register} /></div><TextInput label="Description" name="description" register={chargeForm.register} /><button type="submit" data-testid="button-save-charge" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm font-bold text-white"><Save size={16} />{editingCharge ? "Save charge" : "Issue charge"}</button></div></form></Form><div><h3 className="mb-4 font-serif text-2xl font-bold">Private charges</h3>{chargesQuery.isLoading ? <LoadingRows name="managed-charges" /> : (chargesQuery.data ?? []).length === 0 ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="empty-managed-charges">No individual charges issued.</p> : <div className="space-y-3" data-testid="list-managed-charges">{chargesQuery.data?.map((charge) => <article key={charge.id} className="rounded-2xl border border-border p-4" data-testid={`row-managed-charge-${charge.id}`}><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><div className="flex items-center gap-2"><h4 className="font-serif text-lg font-bold">{charge.studentName}</h4><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase">{label(charge.status)}</span></div><p className="mt-1 text-sm text-muted-foreground">{charge.className} · {charge.term} · {money(charge.amountKobo)} · {charge.description}</p><div className="mt-2 flex items-center gap-2 text-xs"><span className="font-mono font-bold" data-testid={`text-charge-reference-${charge.id}`}>{charge.reference}</span><button type="button" onClick={() => void copyReference(charge.reference)} data-testid={`button-copy-charge-reference-${charge.id}`} className="text-primary hover:underline">{copiedReference === charge.reference ? <Check size={14} /> : <Clipboard size={14} />}</button></div></div><div className="flex gap-2"><button type="button" onClick={() => editCharge(charge)} data-testid={`button-edit-charge-${charge.id}`} className="rounded-lg border border-border p-2 hover:text-primary"><Pencil size={15} /></button><button type="button" onClick={() => remove("individual charge", () => deleteCharge.mutateAsync({ id: charge.id }), invalidate.charges)} data-testid={`button-cancel-charge-${charge.id}`} className="rounded-lg border border-destructive/20 p-2 text-destructive"><Trash2 size={15} /></button></div></div></article>)}</div>}</div></div></div></div>}
      {activePanel === "orders" && <div><h3 className="mb-4 font-serif text-2xl font-bold">Store order requests</h3><p className="mb-6 text-sm text-muted-foreground">Update the fulfilment record and offline payment record separately.</p>{ordersQuery.isLoading ? <LoadingRows name="managed-orders" /> : (ordersQuery.data ?? []).length === 0 ? <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground" data-testid="empty-managed-orders">No store order requests yet.</p> : <div className="space-y-4" data-testid="list-managed-orders">{ordersQuery.data?.map((order) => <article key={order.id} className="rounded-2xl border border-border p-5" data-testid={`row-managed-order-${order.id}`}><div className="flex flex-col justify-between gap-4 lg:flex-row"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-serif text-xl font-bold">{order.studentName}</h4><span className="font-mono text-xs text-muted-foreground">{order.reference}</span></div><p className="mt-1 text-sm text-muted-foreground">{order.guardianName} · {order.studentClass} · {money(order.totalKobo)}</p><p className="mt-3 text-sm">{order.items.map((item) => `${item.title} × ${item.quantity}`).join(", ")}</p><p className="mt-2 text-xs text-muted-foreground">{order.guardianEmail} · {order.guardianPhone}</p></div><div className="grid gap-3 sm:grid-cols-2 lg:w-[22rem]"><label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fulfilment<select value={order.orderStatus} onChange={(e) => updateOrderField(order.id, { orderStatus: e.target.value as typeof orderStatuses[number] })} data-testid={`select-order-status-${order.id}`} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal">{orderStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label><label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Payment record<select value={order.paymentStatus} onChange={(e) => updateOrderField(order.id, { paymentStatus: e.target.value as typeof paymentStatuses[number] })} data-testid={`select-order-payment-${order.id}`} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal">{paymentStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label><input defaultValue={order.officeNote ?? ""} placeholder="Office note" data-testid={`input-order-note-${order.id}`} className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2" onBlur={(e) => { if (e.target.value !== (order.officeNote ?? "")) updateOrderField(order.id, { officeNote: e.target.value || null }); }} /></div></div></article>)}</div>}</div>}
      {activePanel === "reports" && <div><h3 className="mb-4 font-serif text-2xl font-bold">Fee payment reports</h3><p className="mb-6 text-sm text-muted-foreground">Confirm only after the School Office has checked the offline transfer. A reported payment is not automatically confirmed.</p>{reportsQuery.isLoading ? <LoadingRows name="managed-reports" /> : (reportsQuery.data ?? []).length === 0 ? <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground" data-testid="empty-managed-reports">No fee payment reports yet.</p> : <div className="space-y-4" data-testid="list-managed-reports">{reportsQuery.data?.map((report) => <article key={report.id} className="rounded-2xl border border-border p-5" data-testid={`row-managed-report-${report.id}`}><div className="flex flex-col justify-between gap-4 lg:flex-row"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-serif text-xl font-bold">{report.studentName}</h4><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase">{label(report.status)}</span></div><p className="mt-1 text-sm text-muted-foreground">{label(report.feeType)} · {report.className} · {money(report.amountKobo)}</p><p className="mt-2 text-sm">{report.guardianName} · {report.guardianEmail} · {report.guardianPhone}</p><p className="mt-2 text-xs text-muted-foreground">Report {report.reference}{report.transferReference ? ` · Transfer ${report.transferReference}` : ""}</p></div><div className="grid gap-3 sm:w-[22rem]"><label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Review outcome<select value={report.status} onChange={(e) => updateReportField(report.id, { status: e.target.value as typeof reportStatuses[number] })} data-testid={`select-report-status-${report.id}`} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal">{reportStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label><input defaultValue={report.officeNote ?? ""} placeholder="Office note" data-testid={`input-report-note-${report.id}`} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" onBlur={(e) => { if (e.target.value !== (report.officeNote ?? "")) updateReportField(report.id, { officeNote: e.target.value || null }); }} /></div></div></article>)}</div>}</div>}
      {activePanel === "settings" && <Form {...settingsForm}><form onSubmit={settingsForm.handleSubmit((values) => run(() => updateSettings.mutateAsync({ data: { paymentInstructions: values.paymentInstructions } }), "Public payment instructions updated.", invalidate.settings))} className="max-w-2xl" data-testid="form-commerce-settings"><div className="mb-6 flex items-start gap-4"><Settings2 className="mt-1 text-primary" size={23} /><div><h3 className="font-serif text-2xl font-bold">Public payment instructions</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Only save instructions that families should see. Leave blank to hide this panel on the public commerce page.</p></div></div><textarea defaultValue={settingsQuery.data?.paymentInstructions ?? ""} {...settingsForm.register("paymentInstructions")} data-testid="input-payment-instructions" rows={9} placeholder="Bank name, account details, and the School Office process for offline transfers." className="w-full resize-y rounded-2xl border border-border bg-background p-4 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /><button type="submit" disabled={updateSettings.isPending} data-testid="button-save-payment-instructions" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">{updateSettings.isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save instructions</button></form></Form>}
    </div>
  </section>;
}