import { useGetMyFacilities, getGetMyFacilitiesQueryKey } from "@workspace/api-client-react";
import { BedDouble, Bus, Phone } from "lucide-react";
import { productPhotoUrl } from "@/lib/productPhotoUrl";
import { EmptyState, ErrorPanel, Skeleton } from "./ui";
import { errorMessage } from "./lib";

const naira = (kobo: number) => "₦" + (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 });

/** A student's hostel room and school bus route, as the office allocated them. */
export function StudentFacilities() {
  const q = useGetMyFacilities({ query: { queryKey: getGetMyFacilitiesQueryKey() } });
  if (q.isLoading) return <Skeleton className="h-56" />;
  if (q.isError || !q.data) return <ErrorPanel title="This page did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { hostel, transport } = q.data;
  if (!hostel && !transport) return <EmptyState icon={<BedDouble size={22} />} title="No hostel room or bus route" body="When the school office gives you a hostel room or a place on a school bus, the details appear here." />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {hostel && (
        <section className="portal-card overflow-hidden" data-testid="card-my-hostel">
          {hostel.imageUrl && <img src={productPhotoUrl(hostel.imageUrl)} alt={`${hostel.block}, ${hostel.room}`} className="h-44 w-full object-cover" />}
          <div className="p-5">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[hsl(var(--p-emerald))]"><BedDouble size={14} aria-hidden="true" /> Hostel</p>
            <h2 className="mt-1 font-serif text-2xl font-semibold">{hostel.block}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Room</dt><dd className="font-semibold">{hostel.room}</dd></div>
              <div><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Bed space</dt><dd className="font-semibold">{hostel.bed || "-"}</dd></div>
              <div><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Sharing with</dt><dd className="font-semibold">{hostel.roommates === 0 ? "Nobody yet" : `${hostel.roommates} ${hostel.roommates === 1 ? "student" : "students"}`}</dd></div>
              <div><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Hostel fee</dt><dd className="font-semibold">{hostel.priceKobo ? `${naira(hostel.priceKobo)} per term` : "-"}</dd></div>
            </dl>
          </div>
        </section>
      )}
      {transport && (
        <section className="portal-card p-5" data-testid="card-my-route">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[hsl(var(--p-emerald))]"><Bus size={14} aria-hidden="true" /> School bus</p>
          <h2 className="mt-1 font-serif text-2xl font-semibold">{transport.route}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Your stop</dt><dd className="font-semibold">{transport.stop}</dd></div>
            <div><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Fee</dt><dd className="font-semibold">{transport.feeKobo ? `${naira(transport.feeKobo)} per term` : "-"}</dd></div>
            <div><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Morning pick-up</dt><dd className="font-serif text-xl font-semibold tabular-nums">{transport.pickup || "-"}</dd></div>
            <div><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Afternoon drop-off</dt><dd className="font-serif text-xl font-semibold tabular-nums">{transport.dropoff || "-"}</dd></div>
          </dl>
          {(transport.driverName || transport.vehicle) && (
            <p className="mt-4 rounded-xl bg-[hsl(var(--p-paper-2)/0.7)] p-3 text-sm">
              {transport.driverName && <>Driver: <b>{transport.driverName}</b>{transport.driverPhone && <> · <a className="font-semibold text-[hsl(var(--p-emerald))]" href={`tel:${transport.driverPhone.replace(/\s/g, "")}`}><Phone size={12} className="mr-0.5 inline" />{transport.driverPhone}</a></>}<br /></>}
              {[transport.vehicle, transport.plate].filter(Boolean).join(" · ")}
            </p>
          )}
          <ol className="mt-4 space-y-1 text-sm" aria-label="All stops">
            {transport.stops.map((s) => <li key={s.name} className={"flex justify-between gap-2 rounded-lg px-2 py-1 " + (s.name === transport.stop ? "bg-[hsl(var(--p-emerald-soft)/0.7)] font-semibold" : "")}><span>{s.name}</span><span className="tabular-nums text-[hsl(var(--p-ink)/0.65)]">{[s.pickup, s.dropoff].filter(Boolean).join(" / ")}</span></li>)}
          </ol>
        </section>
      )}
    </div>
  );
}
