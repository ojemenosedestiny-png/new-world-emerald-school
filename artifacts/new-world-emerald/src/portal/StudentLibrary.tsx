import { useMemo, useState } from "react";
import type { PortalDashboard } from "@workspace/api-client-react";
import { BookOpen, FileText, Search } from "lucide-react";
import { EmptyState } from "./ui";
import { fileUrl } from "./lib";

type Material = PortalDashboard["materials"][number];

/** Filters notes by subject and search text, then groups them by subject. */
export function libraryGroups(materials: Material[], subject: string, query: string) {
  const q = query.trim().toLowerCase();
  const keep = materials.filter((m) => (!subject || m.subject === subject) && (!q || [m.title, m.subject, m.body].some((v) => v?.toLowerCase().includes(q))));
  const groups = new Map<string, Material[]>();
  for (const m of keep) groups.set(m.subject, [...(groups.get(m.subject) ?? []), m]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function StudentLibrary({ materials }: { materials: Material[] }) {
  const [subject, setSubject] = useState("");
  const [query, setQuery] = useState("");
  const subjects = useMemo(() => [...new Set(materials.map((m) => m.subject))].sort(), [materials]);
  const groups = libraryGroups(materials, subject, query);
  if (!materials.length) return <EmptyState icon={<BookOpen size={22} />} title="No revision notes yet" body="Your teachers will share class notes and practice material here." />;
  return (
    <div className="space-y-4">
      <div className="portal-card space-y-3 p-4">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--p-ink)/0.45)]" aria-hidden="true" />
          <input type="search" className="portal-input !pl-9" placeholder="Search notes" aria-label="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="input-library-search" />
        </label>
        {subjects.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Subjects">
            {["", ...subjects].map((s) => (
              <button key={s || "all"} type="button" aria-pressed={subject === s} onClick={() => setSubject(s)} className={"rounded-full border px-3 py-1 text-sm font-semibold " + (subject === s ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))]")} data-testid={`chip-subject-${s || "all"}`}>
                {s || "All subjects"}
              </button>
            ))}
          </div>
        )}
      </div>
      {!groups.length ? <p className="py-8 text-center text-sm text-[hsl(var(--p-ink)/0.6)]" data-testid="text-library-empty">No notes match your search.</p> : groups.map(([name, items]) => (
        <section key={name} aria-label={name}>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">{name}<span className="rounded-full bg-[hsl(var(--p-paper-2))] px-2 text-xs font-bold">{items.length}</span></h2>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((m, i) => (
              <article key={m.id ?? i} className="portal-card p-5" data-testid={"card-material-" + (m.id ?? i)}>
                <h3 className="font-serif text-xl font-semibold">{m.title}</h3>
                {m.body && <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--p-ink)/0.78)]">{m.body}</p>}
                {m.fileId && <a href={fileUrl(m.fileId)} target="_blank" rel="noreferrer" className="portal-btn-ghost mt-4" data-testid={"link-material-file-" + (m.id ?? i)}><FileText size={14} /> Open PDF</a>}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
