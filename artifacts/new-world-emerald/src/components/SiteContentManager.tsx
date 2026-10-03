import React, { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetSiteContentQueryKey, useGetSiteContent, useRequestUploadUrl, useUpdateSiteContent } from "@workspace/api-client-react";
import { schoolContentFields, type SchoolContentField } from "virtual:school-content-catalog";
import { ExternalLink, Loader2, Save, Search, Upload } from "lucide-react";
import { asset } from "@/lib/asset";

export function SiteContentManager() {
  const query = useGetSiteContent();
  const update = useUpdateSiteContent();
  const upload = useRequestUploadUrl();
  const queryClient = useQueryClient();
  const [group, setGroup] = useState("Welcome banner");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const dirty = Object.keys(drafts).length > 0;
  const groups = useMemo(() => [...new Set(schoolContentFields.map((field) => field.group))].sort(), []);
  const fields = schoolContentFields.filter((field) =>
    (group === "All sections" || field.group === group) &&
    `${field.label} ${field.group} ${field.defaultValue}`.toLowerCase().includes(search.toLowerCase()));
  const current = (field: SchoolContentField) => drafts[field.key] ?? query.data?.values[field.key] ?? field.defaultValue;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(field: SchoolContentField, value: string) {
    if (baseRevision === null) setBaseRevision(query.data?.revision ?? 0);
    setDrafts((previous) => ({ ...previous, [field.key]: value }));
    setMessage("");
    setError("");
  }

  async function save() {
    if (!query.data || !dirty || uploadingKey) return;
    setError(""); setMessage("");
    try {
      const result = await update.mutateAsync({ data: { revision: baseRevision ?? query.data.revision, values: drafts } });
      queryClient.setQueryData(getGetSiteContentQueryKey(), result);
      setDrafts({}); setBaseRevision(null);
      setMessage("Website updated. Your saved changes are now published.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save. Your unsaved changes are still here; please try again.");
    }
  }

  async function uploadFile(field: SchoolContentField, file?: File) {
    if (!file) return;
    const permitted = field.kind === "image" ? ["image/jpeg", "image/png", "image/webp", "image/gif"]
      : field.kind === "media" ? ["video/mp4", "video/webm"]
      : ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!permitted.includes(file.type) || file.size > 25 * 1024 * 1024) {
      setError("Choose a supported file up to 25 MB. Photos should be JPG, PNG, WebP or GIF.");
      return;
    }
    setUploadingKey(field.key); setError(""); setMessage("");
    try {
      const result = await upload.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type } });
      await customFetch(result.uploadURL, { method: "PUT", credentials: "omit", headers: { "Content-Type": file.type }, body: file, responseType: "text" });
      edit(field, `/api/storage${result.objectPath}`);
      setMessage("File uploaded. Choose Save and publish to display it on the website.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File upload failed.");
    } finally { setUploadingKey(null); }
  }

  async function discard() {
    if (dirty && !window.confirm("Discard your unsaved website edits?")) return;
    setDrafts({}); setBaseRevision(null); setError(""); setMessage("");
    await query.refetch();
  }

  return (
    <section id="website-content" className="rounded-3xl border border-border bg-card p-5 shadow-sm md:p-8" data-testid="website-content-manager">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">Website management</p>
          <h2 className="font-serif text-3xl font-bold">Edit the school website</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Manage text, photos, programme notes, school information, contacts and section visibility.
            Saving publishes your changes; original school content stays available through each Reset control.
          </p>
        </div>
        <a href={asset("/")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-semibold">
          Preview website <ExternalLink size={15} />
        </a>
      </div>

      <div className="mt-6 flex flex-col gap-3 md:flex-row">
        <label className="min-w-0 md:w-64">
          <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Website section</span>
          <select value={group} onChange={(event) => setGroup(event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm" data-testid="select-content-section">
            <option>All sections</option>
            {groups.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <label className="min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Find text or photos</span>
          <div className="relative">
            <Search className="absolute left-3 top-3.5 text-muted-foreground" size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search school content…" className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-3 text-sm" data-testid="input-content-search" />
          </div>
        </label>
      </div>

      <div className="sticky top-2 z-10 my-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/95 p-4 backdrop-blur">
        <p className="text-sm text-muted-foreground">{dirty ? `${Object.keys(drafts).length} unsaved changes` : "Your website is up to date"}
          {query.data?.updatedAt && <span className="ml-2 text-xs">Last saved {new Date(query.data.updatedAt).toLocaleString()}</span>}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={discard} disabled={update.isPending || !!uploadingKey} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Reload / discard edits</button>
          <button type="button" onClick={save} disabled={!dirty || !query.data || update.isPending || !!uploadingKey} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-publish-website">
            {update.isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            {update.isPending ? "Saving…" : "Save and publish"}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
      {query.isLoading && <p className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="animate-spin" size={18} /> Loading saved website content…</p>}
      {query.isError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">Website content could not be loaded. Use Reload to try again before making edits.</p>}
      {query.data && <div className="max-h-[640px] space-y-4 overflow-y-auto pr-1">
        {fields.length === 0 && <p className="py-10 text-center text-muted-foreground">No content matches your search.</p>}
        {fields.map((field) => {
          const value = current(field);
          const media = ["image", "media", "file"].includes(field.kind);
          return (
            <div key={field.key} className="rounded-2xl border border-border bg-background p-4" data-testid={`content-field-${field.key}`}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <label htmlFor={`field-${field.key}`} className="min-w-0 break-words text-sm font-semibold">{field.label || "School text"}{group === "All sections" && <span className="mt-1 block text-xs font-normal text-muted-foreground">{field.group}</span>}</label>
                <button type="button" onClick={() => edit(field, field.defaultValue)} className="shrink-0 text-xs font-semibold text-primary">Reset</button>
              </div>
              {field.kind === "toggle" ? <label className="inline-flex items-center gap-3 text-sm">
                <input id={`field-${field.key}`} type="checkbox" checked={value !== "false"} onChange={(event) => edit(field, event.target.checked ? "true" : "false")} />
                Visible to website visitors
              </label> : field.kind === "text" ? <textarea id={`field-${field.key}`} value={value} onChange={(event) => edit(field, event.target.value)} rows={value.length > 180 ? 4 : 2} maxLength={20000} className="w-full resize-y rounded-xl border border-border bg-card px-3 py-3 text-sm leading-relaxed" /> : <>
                {field.kind === "image" && value && <img src={value} alt={field.label} className="mb-3 h-28 max-w-full rounded-xl bg-muted object-contain" />}
                <input id={`field-${field.key}`} value={value} onChange={(event) => edit(field, event.target.value)} className="w-full rounded-xl border border-border bg-card px-3 py-3 text-sm" placeholder="https://… or an uploaded file path" />
                {field.kind === "link" && value === "#" && <p className="mt-2 text-xs text-amber-700">This link has no destination yet. Add an approved school page or document URL to make it useful.</p>}
                {media && <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">
                  {uploadingKey === field.key ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploadingKey === field.key ? "Uploading…" : `Upload ${field.kind === "image" ? "photo" : field.kind === "media" ? "video" : "document"}`}
                  <input type="file" className="sr-only" disabled={!!uploadingKey || update.isPending} accept={field.kind === "image" ? ".jpg,.jpeg,.png,.webp,.gif" : field.kind === "media" ? ".mp4,.webm" : ".pdf,.doc,.docx"} onChange={(event) => { uploadFile(field, event.target.files?.[0]); event.target.value = ""; }} />
                </label>}
              </>}
            </div>
          );
        })}
      </div>}
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Admissions, calendars, live updates, school fees and store products are managed in their dedicated tools below. Keep Cambridge and Nigerian curriculum wording accurate; do not add accreditation claims unless confirmed by the school.</p>
    </section>
  );
}