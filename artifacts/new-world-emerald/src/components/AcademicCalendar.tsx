import { AnimatedHeading } from "@/components/AnimatedHeading";
import React, { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  LockKeyhole,
  Trash2,
  Upload,
} from "lucide-react";
import {
  getListAcademicCalendarQueryKey,
  useCreateAcademicCalendar,
  useDeleteAcademicCalendar,
  useListAcademicCalendar,
  useRequestUploadUrl,
} from "@workspace/api-client-react";
import { useAuth, useUser } from "@clerk/react";
import { customFetch } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileUrl(objectPath: string) {
  return `/api/storage${objectPath}`;
}

function isVideo(calendar: { contentType: string; fileName: string }) {
  return calendar.contentType.toLowerCase().startsWith("video/") ||
    /\.(mp4|m4v|webm|mov|ogv)$/i.test(calendar.fileName);
}

export function AcademicCalendar({ officeMode = false }: { officeMode?: boolean }) {
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  const isAuthenticated = isLoaded && isSignedIn === true;
  const isAuthLoading = !isLoaded;
  const [, setLocation] = useLocation();
  const login = () => setLocation("/sign-in");
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: calendars, isLoading, isError } = useListAcademicCalendar();
  const requestUploadUrl = useRequestUploadUrl();
  const createCalendar = useCreateAcademicCalendar();
  const deleteCalendar = useDeleteAcademicCalendar();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [term, setTerm] = useState("2025/2026 Academic Session");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const visibleCalendars = useMemo(
    () => (calendars ?? []).slice().sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [calendars],
  );

  const resetForm = () => {
    setSelectedFile(null);
    setTitle("");
    setWeekStart("");
    setWeekEnd("");
    setUploadError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file && !title) {
      setTitle(file.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " "));
    }
    setUploadError("");
  };

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFile || !title.trim() || !weekStart || !weekEnd || !term.trim()) {
      setUploadError("Add a title, week dates, term, and calendar file before publishing.");
      return;
    }
    if (weekEnd < weekStart) {
      setUploadError("The week ending date must be on or after the week starting date.");
      return;
    }

    setIsUploading(true);
    setUploadError("");
    try {
      const upload = await requestUploadUrl.mutateAsync({
        data: {
          name: selectedFile.name,
          size: selectedFile.size,
          contentType: selectedFile.type || "application/octet-stream",
        },
      });

      await customFetch(upload.uploadURL, {
        method: "PUT",
        credentials: "omit",
        headers: { "Content-Type": selectedFile.type || "application/octet-stream" },
        body: selectedFile,
        responseType: "text",
      });

      await createCalendar.mutateAsync({
        data: {
          title: title.trim(),
          weekStart,
          weekEnd,
          term: term.trim(),
          fileName: selectedFile.name,
          objectPath: upload.objectPath,
          contentType: selectedFile.type || "application/octet-stream",
          fileSize: selectedFile.size,
        },
      });

      await queryClient.invalidateQueries({
        queryKey: getListAcademicCalendarQueryKey(),
      });
      resetForm();
      setIsUploadOpen(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Remove this calendar from the public website?")) return;
    try {
      await deleteCalendar.mutateAsync({ id });
      await queryClient.invalidateQueries({
        queryKey: getListAcademicCalendarQueryKey(),
      });
    } catch {
      setUploadError("This calendar could not be removed. Please try again.");
    }
  };

  return (
    <section id="calendar" className={`relative overflow-hidden bg-secondary text-secondary-foreground ${officeMode ? "rounded-2xl py-8" : "py-24"}`}>
      <div className="absolute right-0 top-0 h-80 w-80 translate-x-1/3 -translate-y-1/3 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute bottom-0 left-0 h-72 w-72 -translate-x-1/3 translate-y-1/3 rounded-full bg-accent/10 blur-3xl" />

      <div className="container relative z-10 mx-auto px-4 md:px-8">
        <div className="mb-12 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.24em] text-accent">
              Stay organised
            </p>
            <AnimatedHeading as="h2" className="mb-5 text-4xl font-bold leading-tight text-white md:text-5xl">
              Academic Calendar
            </AnimatedHeading>
            <p className="text-base leading-relaxed text-white/70 md:text-lg">
              Keep up with each week at New World Emerald. The school office will
              publish the latest timetable, reminders, and important dates here.
            </p>
          </div>
          <a
            href="mailto:info@newworldemeraldprivateschool.com?subject=Academic%20Calendar%20Query"
            className="inline-flex items-center gap-2 self-start rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-accent hover:text-accent lg:self-auto"
          >
            Ask the school office <ArrowRight size={16} />
          </a>
        </div>

        <div className={`grid gap-8 ${officeMode && isAuthenticated ? "lg:grid-cols-[1.25fr_0.75fr]" : ""}`}>
          <div className="space-y-4">
            {isLoading && (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-8 text-white/70">
                <Loader2 className="animate-spin" size={20} /> Loading the latest calendars…
              </div>
            )}
            {isError && (
              <div className="rounded-2xl border border-red-300/20 bg-red-400/10 p-8 text-white/80">
                We couldn’t load the calendar right now. Please refresh or contact the school office.
              </div>
            )}
            {!isLoading && !isError && visibleCalendars.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-10 text-center">
                <CalendarDays className="mx-auto mb-4 text-accent" size={34} />
                <AnimatedHeading as="h3" className="mb-2 font-serif text-2xl font-semibold text-white">
                  The first weekly update is coming soon
                </AnimatedHeading>
                <p className="mx-auto max-w-md text-sm leading-relaxed text-white/60">
                  Check back here for the school’s latest academic calendar and weekly notices.
                </p>
              </div>
            )}
            {visibleCalendars.map((calendar, index) => (
              <motion.article
                key={calendar.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ delay: index * 0.06 }}
                className={`group flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.07] p-5 backdrop-blur-sm transition-colors hover:border-accent/50 ${isVideo(calendar) ? "" : "sm:flex-row sm:items-center sm:justify-between"}`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
                    <FileText size={22} />
                  </div>
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {index === 0 && (
                        <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-secondary">
                          Latest
                        </span>
                      )}
                      <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
                        {calendar.term}
                      </span>
                    </div>
                    <AnimatedHeading as="h3" className="font-serif text-xl font-semibold text-white">{calendar.title}</AnimatedHeading>
                    <p className="mt-1 text-sm text-white/60">
                      {formatDate(calendar.weekStart)} — {formatDate(calendar.weekEnd)}
                      <span className="mx-2 text-white/30">•</span>
                      {formatFileSize(calendar.fileSize)}
                    </p>
                  </div>
                </div>
                {isVideo(calendar) && (
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
                    <video
                      controls
                      playsInline
                      preload="metadata"
                      src={fileUrl(calendar.objectPath)}
                      aria-label={calendar.title}
                      className="block aspect-video w-full max-h-[70vh] object-contain"
                      data-testid={`video-calendar-${calendar.id}`}
                    >
                      Your browser cannot play this video.{" "}
                      <a href={fileUrl(calendar.objectPath)}>Open the video</a>.
                    </video>
                  </div>
                )}
                <div className="flex items-center gap-3 sm:shrink-0">
                  {!isVideo(calendar) && <a
                    href={fileUrl(calendar.objectPath)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-secondary transition-colors hover:bg-accent"
                  >
                    <Download size={16} /> View
                  </a>}
                  {officeMode && isAuthenticated && (
                    <button
                      type="button"
                      onClick={() => handleDelete(calendar.id)}
                      aria-label={`Remove ${calendar.title}`}
                      className="rounded-full p-2.5 text-white/40 transition-colors hover:bg-red-400/15 hover:text-red-200"
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
              </motion.article>
            ))}
          </div>

          {officeMode && isAuthenticated && <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-6 backdrop-blur-sm">
            {!isUploadOpen ? (
              <div className="flex h-full flex-col justify-between gap-8">
                <div>
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-secondary">
                    <Upload size={22} />
                  </div>
                  <AnimatedHeading as="h3" className="mb-3 font-serif text-2xl font-semibold text-white">
                    School office upload
                  </AnimatedHeading>
                  <p className="text-sm leading-relaxed text-white/65">
                    Publish a new weekly calendar securely. Uploaded files are stored
                    centrally and become available to every parent and student.
                  </p>
                </div>
                {isAuthLoading ? (
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <Loader2 className="animate-spin" size={17} /> Checking office access…
                  </div>
                ) : isAuthenticated ? (
                  <button
                    type="button"
                    onClick={() => setIsUploadOpen(true)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-white transition-colors hover:bg-primary/90"
                  >
                    <Upload size={17} /> Upload weekly calendar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={login}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-white transition-colors hover:bg-primary/90"
                  >
                    <LockKeyhole size={17} /> School office login
                  </button>
                )}
                <p className="flex items-center gap-2 text-xs text-white/40">
                  <CheckCircle2 size={14} className="text-accent" /> PDF, Word, or image files up to 25 MB
                </p>
              </div>
            ) : (
              <form onSubmit={handleUpload} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-accent">Office upload</p>
                    <AnimatedHeading as="h3" className="mt-1 font-serif text-2xl font-semibold text-white">Add this week</AnimatedHeading>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setIsUploadOpen(false);
                    }}
                    className="text-sm text-white/50 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
                <label className="block text-sm font-medium text-white/80">
                  Calendar file
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.mp4,.m4v,.webm,.mov,.ogv"
                    onChange={handleFileChange}
                    className="mt-2 block w-full cursor-pointer rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-2 file:font-semibold file:text-secondary"
                  />
                </label>
                <label className="block text-sm font-medium text-white/80">
                  Title
                  <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Week 5 Academic Calendar" className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-accent" />
                </label>
                <label className="block text-sm font-medium text-white/80">
                  Term
                  <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="2025/2026 Academic Session" className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-accent" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-medium text-white/80">
                    Week starts
                    <input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-accent" />
                  </label>
                  <label className="block text-sm font-medium text-white/80">
                    Week ends
                    <input type="date" value={weekEnd} onChange={(event) => setWeekEnd(event.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-accent" />
                  </label>
                </div>
                {uploadError && <p className="rounded-lg bg-red-400/10 p-3 text-xs leading-relaxed text-red-100">{uploadError}</p>}
                <button type="submit" disabled={isUploading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3.5 text-sm font-bold text-secondary transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60">
                  {isUploading ? <><Loader2 className="animate-spin" size={17} /> Publishing…</> : <><Upload size={17} /> Publish calendar</>}
                </button>
                <p className="text-xs text-white/40">
                  Signed in as {user?.primaryEmailAddress?.emailAddress ?? "school office user"}. Publishing makes this update visible to everyone.
                </p>
              </form>
            )}
          </div>}
        </div>
      </div>
    </section>
  );
}