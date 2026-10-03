import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  FileVideo,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  customFetch,
  getListLiveUpdatesQueryKey,
  useCreateLiveUpdate,
  useDeleteLiveUpdate,
  useListLiveUpdates,
  useRequestUploadUrl,
  useUpdateLiveUpdate,
} from "@workspace/api-client-react";

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

function formatPublishedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LiveUpdatesManager() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updatesQuery = useListLiveUpdates();
  const requestUploadUrl = useRequestUploadUrl();
  const createLiveUpdate = useCreateLiveUpdate();
  const updateLiveUpdate = useUpdateLiveUpdate();
  const deleteLiveUpdate = useDeleteLiveUpdate();

  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [uploadStage, setUploadStage] = useState<"idle" | "preparing" | "uploading" | "publishing">("idle");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

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
  const isPublishing = uploadStage !== "idle";

  const invalidateUpdates = async () => {
    await queryClient.invalidateQueries({ queryKey: getListLiveUpdatesQueryKey() });
  };

  const resetComposer = () => {
    setSelectedFile(null);
    setTitle("");
    setDescription("");
    setFormError("");
    setUploadStage("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setFormError("");
    setSelectedFile(file);
    if (file && !title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " "));
    }
    if (file && file.size > MAX_VIDEO_SIZE) {
      setFormError("Choose a video under 100 MB.");
    } else if (file && !file.type.startsWith("video/")) {
      setFormError("Please choose a video file. The school office accepts video files only.");
    }
  };

  const handlePublish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccessMessage("");
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!selectedFile || !trimmedTitle || !trimmedDescription) {
      setFormError("Add a video, title, and short description before publishing.");
      return;
    }
    if (!selectedFile.type.startsWith("video/")) {
      setFormError("Please choose a video file. The school office accepts video files only.");
      return;
    }
    if (selectedFile.size > MAX_VIDEO_SIZE) {
      setFormError("Choose a video under 100 MB.");
      return;
    }

    setFormError("");
    setUploadStage("preparing");
    try {
      const upload = await requestUploadUrl.mutateAsync({
        data: {
          name: selectedFile.name,
          size: selectedFile.size,
          contentType: selectedFile.type,
        },
      });
      setUploadStage("uploading");
      await customFetch(upload.uploadURL, {
        method: "PUT",
        credentials: "omit",
        headers: { "Content-Type": selectedFile.type },
        body: selectedFile,
        responseType: "text",
      });

      setUploadStage("publishing");
      await createLiveUpdate.mutateAsync({
        data: {
          title: trimmedTitle,
          description: trimmedDescription,
          fileName: selectedFile.name,
          objectPath: upload.objectPath,
          contentType: selectedFile.type,
          fileSize: selectedFile.size,
        },
      });
      await invalidateUpdates();
      resetComposer();
      setIsComposerOpen(false);
      setSuccessMessage("Your video is now live on the website.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Publishing failed. Please try again.");
      setUploadStage("idle");
    }
  };

  const startEditing = (id: number, currentTitle: string, currentDescription: string) => {
    setEditingId(id);
    setEditTitle(currentTitle);
    setEditDescription(currentDescription);
    setEditError("");
    setSuccessMessage("");
  };

  const handleSaveEdit = async (id: number) => {
    if (!editTitle.trim() || !editDescription.trim()) {
      setEditError("A title and description are required.");
      return;
    }
    setEditError("");
    try {
      await updateLiveUpdate.mutateAsync({
        id,
        data: { title: editTitle.trim(), description: editDescription.trim() },
      });
      await invalidateUpdates();
      setEditingId(null);
      setSuccessMessage("Update details saved.");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "This update could not be saved.");
    }
  };

  const handleDelete = async (id: number, updateTitle: string) => {
    if (!window.confirm(`Remove “${updateTitle}” from the public website?`)) return;
    setDeletingId(id);
    setSuccessMessage("");
    try {
      await deleteLiveUpdate.mutateAsync({ id });
      await invalidateUpdates();
      setSuccessMessage("The live update was removed.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "This update could not be removed.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenComposer = () => {
    setSuccessMessage("");
    setFormError("");
    setIsComposerOpen(true);
  };

  return (
    <section className="rounded-3xl border border-border bg-card shadow-sm" data-testid="live-updates-manager">
      <div className="flex flex-col justify-between gap-5 border-b border-border p-6 sm:flex-row sm:items-center">
        <div>
          <div className="mb-3 flex items-center gap-2 text-primary">
            <Clapperboard size={20} />
            <p className="text-xs font-bold uppercase tracking-[0.2em]">Public website</p>
          </div>
          <h2 className="font-serif text-3xl font-bold text-foreground">Live school updates</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Give families a current window into learning, creativity, and community.
          </p>
        </div>
        {!isComposerOpen && (
          <button
            type="button"
            onClick={handleOpenComposer}
            data-testid="button-add-live-update"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={17} /> Publish a video
          </button>
        )}
      </div>

      {successMessage && (
        <div
          className="mx-6 mt-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-primary"
          role="status"
          data-testid="success-live-update"
        >
          <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
          <span>{successMessage}</span>
        </div>
      )}

      {formError && !isComposerOpen && (
        <div
          className="mx-6 mt-6 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
          data-testid="error-live-update-manager-action"
        >
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <span>{formError}</span>
        </div>
      )}

      {isComposerOpen && (
        <form onSubmit={handlePublish} className="m-6 rounded-2xl border border-primary/15 bg-primary/[0.03] p-5" data-testid="form-live-update">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">New story</p>
              <h3 className="mt-1 font-serif text-2xl font-bold">Share a school moment</h3>
            </div>
            <button
              type="button"
              onClick={() => {
                resetComposer();
                setIsComposerOpen(false);
              }}
              data-testid="button-cancel-live-update"
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Cancel publishing"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <label data-testid="label-live-update-video" className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-background p-5 text-center transition-colors hover:border-primary hover:bg-primary/[0.03]">
              <FileVideo className="mb-3 text-primary" size={30} />
              <span className="text-sm font-bold text-foreground">
                {selectedFile ? selectedFile.name : "Choose a video file"}
              </span>
              <span className="mt-2 text-xs text-muted-foreground">
                {selectedFile ? formatFileSize(selectedFile.size) : "MP4, MOV, or another video up to 100 MB"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                disabled={isPublishing}
                data-testid="input-live-update-video"
                className="sr-only"
              />
            </label>
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-foreground">
                Title
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Science in motion"
                  disabled={isPublishing}
                  data-testid="input-live-update-title"
                  className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Description
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="A short note for families about what they are seeing."
                  rows={4}
                  disabled={isPublishing}
                  data-testid="input-live-update-description"
                  className="mt-2 w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>
            </div>
          </div>
          {formError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="error-live-update-form">
              <AlertCircle className="mt-0.5 shrink-0" size={17} />
              <span>{formError}</span>
            </div>
          )}
          {isPublishing && (
            <div className="mt-4 rounded-xl bg-muted/70 p-3" data-testid="progress-live-update">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-muted-foreground">
                <span>{uploadStage === "preparing" ? "Preparing secure upload…" : uploadStage === "uploading" ? "Uploading video…" : "Publishing to the website…"}</span>
                <Loader2 size={15} className="animate-spin text-primary" />
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                <div className={`h-full rounded-full bg-primary transition-all duration-500 ${uploadStage === "preparing" ? "w-1/4" : uploadStage === "uploading" ? "w-2/3" : "w-full"}`} />
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={isPublishing}
            data-testid="button-publish-live-update"
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3.5 text-sm font-bold text-secondary transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPublishing ? <><Loader2 size={17} className="animate-spin" /> Publishing…</> : <><UploadCloud size={17} /> Publish video</>}
          </button>
        </form>
      )}

      <div className="p-6">
        {updatesQuery.isLoading && (
          <div className="space-y-3" data-testid="loading-live-update-manager">
            {[0, 1].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-muted" />)}
          </div>
        )}
        {updatesQuery.isError && !updatesQuery.isLoading && (
          <div className="rounded-2xl bg-destructive/5 p-6 text-center" data-testid="error-live-update-manager">
            <AlertCircle className="mx-auto mb-3 text-destructive" size={26} />
            <p className="text-sm text-muted-foreground">Live updates could not be loaded.</p>
            <button type="button" onClick={() => void updatesQuery.refetch()} data-testid="button-retry-live-update-manager" className="mt-4 text-sm font-bold text-primary hover:underline">
              Try again
            </button>
          </div>
        )}
        {!updatesQuery.isLoading && !updatesQuery.isError && updates.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center" data-testid="empty-live-update-manager">
            <Clapperboard className="mx-auto mb-3 text-muted-foreground" size={30} />
            <h3 className="font-serif text-xl font-bold">No videos published yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">Your first video will appear here and on the public website.</p>
          </div>
        )}
        {!updatesQuery.isLoading && !updatesQuery.isError && updates.length > 0 && (
          <div className="space-y-3" data-testid="list-live-update-manager">
            {updates.map((update) => {
              const isEditing = editingId === update.id;
              return (
                <article key={update.id} className="rounded-2xl border border-border p-4 transition-colors hover:border-primary/25" data-testid={`row-live-update-${update.id}`}>
                  {isEditing ? (
                    <div className="space-y-3">
                      <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} data-testid={`input-edit-live-update-title-${update.id}`} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold outline-none focus:border-primary" />
                      <textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={3} data-testid={`input-edit-live-update-description-${update.id}`} className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-primary" />
                      {editError && <p className="text-xs text-destructive" data-testid={`error-edit-live-update-${update.id}`}>{editError}</p>}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => void handleSaveEdit(update.id)} disabled={updateLiveUpdate.isPending} data-testid={`button-save-live-update-${update.id}`} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"><Save size={14} /> Save changes</button>
                        <button type="button" onClick={() => setEditingId(null)} data-testid={`button-cancel-edit-live-update-${update.id}`} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileVideo size={20} /></div>
                        <div className="min-w-0">
                          <h3 className="truncate font-serif text-lg font-bold" data-testid={`title-manager-live-update-${update.id}`}>{update.title}</h3>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground" data-testid={`description-manager-live-update-${update.id}`}>{update.description}</p>
                          <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/75">{formatPublishedDate(update.publishedAt)} · {formatFileSize(update.fileSize)}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => startEditing(update.id, update.title, update.description)} data-testid={`button-edit-live-update-${update.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"><Pencil size={14} /> Edit</button>
                        <button type="button" onClick={() => void handleDelete(update.id, update.title)} disabled={deletingId === update.id} data-testid={`button-delete-live-update-${update.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/20 px-3 py-2 text-xs font-bold text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-60"><Trash2 size={14} /> {deletingId === update.id ? "Removing…" : "Remove"}</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}