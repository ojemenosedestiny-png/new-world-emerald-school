import { AnimatedHeading } from "@/components/AnimatedHeading";
import { motion } from "framer-motion";
import { AlertCircle, CalendarDays, Clapperboard, Loader2, Play, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { getListLiveUpdatesQueryKey, useListLiveUpdates } from "@workspace/api-client-react";

function formatPublishedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently shared";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function videoUrl(objectPath: string) {
  return `/api/storage${objectPath}`;
}

export function LiveUpdates() {
  const updatesQuery = useListLiveUpdates();
  const updates = useMemo(
    () =>
      (updatesQuery.data ?? [])
        .slice()
        .sort(
          (first, second) =>
            new Date(second.publishedAt).getTime() - new Date(first.publishedAt).getTime(),
        ),
    [updatesQuery.data],
  );

  return (
    <section id="live-updates" className="relative overflow-hidden bg-background py-24 md:py-32">
      <div className="pointer-events-none absolute -left-28 top-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-36 bottom-0 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="container relative mx-auto px-4 md:px-8">
        <div className="mb-12 flex flex-col justify-between gap-7 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <div className="mb-5 flex items-center gap-3 text-primary">
              <span className="h-px w-10 bg-accent" />
              <p className="text-xs font-bold uppercase tracking-[0.24em]">A window into school life</p>
            </div>
            <AnimatedHeading as="h2" className="font-serif text-4xl font-bold leading-tight text-foreground md:text-6xl">
              From our classrooms,
              <span className="block italic font-normal text-primary">while it is happening.</span>
            </AnimatedHeading>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              See the questions being asked, the ideas taking shape, and the small moments
              that make each day at New World Emerald meaningful.
            </p>
          </div>
          <div className="flex items-center gap-3 self-start rounded-full border border-primary/15 bg-primary/5 px-4 py-2.5 text-xs font-semibold text-primary md:self-auto">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
            </span>
            Latest from the school community
          </div>
        </div>

        {updatesQuery.isLoading && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3" data-testid="loading-live-updates">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"
                aria-hidden="true"
              >
                <div className="aspect-video animate-pulse bg-muted" />
                <div className="space-y-3 p-6">
                  <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-6 w-4/5 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        )}

        {updatesQuery.isError && (
          <div
            className="rounded-3xl border border-destructive/20 bg-destructive/5 p-8 text-center"
            data-testid="error-live-updates"
          >
            <AlertCircle className="mx-auto mb-4 text-destructive" size={30} />
            <AnimatedHeading as="h3" className="font-serif text-2xl font-bold text-foreground">The window is briefly closed</AnimatedHeading>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              We could not bring in the latest school moments. Please try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => void updatesQuery.refetch()}
              data-testid="button-retry-live-updates"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw size={16} /> Try again
            </button>
          </div>
        )}

        {!updatesQuery.isLoading && !updatesQuery.isError && updates.length === 0 && (
          <div
            className="rounded-3xl border border-dashed border-primary/20 bg-primary/[0.03] px-6 py-14 text-center"
            data-testid="empty-live-updates"
          >
            <Clapperboard className="mx-auto mb-5 text-accent" size={38} />
            <AnimatedHeading as="h3" className="font-serif text-2xl font-bold text-foreground">The first story is still being filmed</AnimatedHeading>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Check back soon for a glimpse of learning, creativity, and community from around the school.
            </p>
          </div>
        )}

        {!updatesQuery.isLoading && !updatesQuery.isError && updates.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3" data-testid="list-live-updates">
            {updates.map((update, index) => (
              <motion.article
                key={update.id}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ delay: index * 0.06, duration: 0.45 }}
                className={`group overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl ${
                  index === 0 ? "md:col-span-2 lg:col-span-2" : ""
                }`}
                data-testid={`card-live-update-${update.id}`}
              >
                <div className={`relative bg-secondary ${index === 0 ? "aspect-[16/8]" : "aspect-video"}`}>
                  <video
                    className="h-full w-full object-cover"
                    controls
                    preload="metadata"
                    playsInline
                    src={videoUrl(update.objectPath)}
                    data-testid={`video-live-update-${update.id}`}
                  >
                    Your browser does not support embedded video playback.
                  </video>
                  <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-secondary/85 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white backdrop-blur-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    {index === 0 ? "Latest story" : "School life"}
                  </div>
                  <div className="pointer-events-none absolute bottom-4 left-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-secondary/75 text-white opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
                    <Play size={16} fill="currentColor" />
                  </div>
                </div>
                <div className="p-6">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <CalendarDays size={14} className="text-accent" />
                    <time dateTime={update.publishedAt} data-testid={`date-live-update-${update.id}`}>
                      {formatPublishedDate(update.publishedAt)}
                    </time>
                  </div>
                  <AnimatedHeading as="h3"
                    className="font-serif text-2xl font-bold leading-tight text-foreground"
                    data-testid={`title-live-update-${update.id}`}
                  >
                    {update.title}
                  </AnimatedHeading>
                  <p
                    className="mt-3 text-sm leading-relaxed text-muted-foreground"
                    data-testid={`description-live-update-${update.id}`}
                  >
                    {update.description}
                  </p>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}