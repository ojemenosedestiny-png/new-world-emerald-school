import { useState } from "react";
import { Download, FileSpreadsheet, ImageIcon, Loader2, LockKeyhole } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FILES: [string, string][] = [
  ["students.csv", "Every student: login ID, full name, class, primary or secondary, status, parent emails, photo file"],
  ["teachers.csv", "Every teacher: login email, name, role, subjects, classes, photo file"],
  ["staff-roles.csv", "Office, Head of School, Director, principals, exam officer, Chairman and bursar logins"],
  ["parents.csv", "Every parent email with their children"],
  ["classes.csv", "Every class with its students, teachers and subjects"],
  ["results.csv", "Every saved report-card mark"],
  ["cbt-scores.csv", "Every CBT exam attempt and score"],
  ["photos/", "Every student's and teacher's photo, named after them"],
];

/** The school owner downloads everything in one ZIP: spreadsheets that open in Excel, and every photo. */
export function ExportEverything() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const url = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/portal/export/everything";
  const download = async () => {
    setBusy(true);
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) {
        const e = await r.json().catch(() => null) as { error?: string } | null;
        throw new Error(e?.error ?? `The download failed (${r.status}).`);
      }
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "school-data.zip";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast({ title: "Downloaded", description: `${name} is in your Downloads folder. Unzip it and open the .csv files in Excel.` });
    } catch (e) {
      toast({ variant: "destructive", title: "Not downloaded", description: (e as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <section className="portal-card p-6">
        <h2 className="font-serif text-2xl font-semibold">Download all the school's data</h2>
        <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--p-ink)/0.7)]">One ZIP file with spreadsheets that open in Excel and every photo. Keep it on your laptop as a record of everyone in the school. Passwords are never included; they are stored scrambled and nobody can read them.</p>
        <button type="button" className="portal-btn mt-5 !py-3.5" disabled={busy} onClick={() => void download()} data-testid="button-export-everything">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} {busy ? "Preparing the download (this can take a few minutes)…" : "Download everything (ZIP)"}
        </button>
        <p className="mt-3 flex items-start gap-2 text-xs text-[hsl(var(--p-ink)/0.65)]"><LockKeyhole size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> This holds children's personal information. Keep it on a password-protected computer and do not share it. Each download is recorded in the audit log.</p>
      </section>
      <section className="portal-card p-6">
        <h3 className="font-serif text-lg font-semibold">What is inside</h3>
        <ul className="mt-3 divide-y divide-[hsl(var(--p-line))]">
          {FILES.map(([file, what]) => (
            <li key={file} className="flex gap-3 py-2.5 text-sm">
              {file.endsWith("/") ? <ImageIcon size={16} className="mt-0.5 shrink-0 text-[hsl(var(--p-emerald))]" aria-hidden="true" /> : <FileSpreadsheet size={16} className="mt-0.5 shrink-0 text-[hsl(var(--p-emerald))]" aria-hidden="true" />}
              <span><b className="font-mono text-xs">{file}</b><span className="block text-[hsl(var(--p-ink)/0.7)]">{what}</span></span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
