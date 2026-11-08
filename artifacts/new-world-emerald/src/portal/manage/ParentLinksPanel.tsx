import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetParentLinksQueryKey, useGetParentLinks, useManageParentLinks, type ParentLinkStudent } from "@workspace/api-client-react";
import { Copy, Link2, Search, Send, Unlink, UserPlus, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The parent's own sign-in link: the parent portal's sign-in with their email filled in. */
export const parentLink = (email: string) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/sign-in?returnTo=parents&email=${encodeURIComponent(email)}`;

/**
 * Link parents to their children. A parent signs in to the parent portal with this email and sees every child
 * linked to it: fees, report cards, results, attendance and homework. Each child can have two parents.
 */
export function ParentLinksPanel() {
  const q = useGetParentLinks({ query: { queryKey: getGetParentLinksQueryKey() } });
  const m = useManageParentLinks();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [email, setEmail] = useState("");
  const [childSearch, setChildSearch] = useState("");
  const copy = (parent: string) => navigator.clipboard.writeText(parentLink(parent)).then(() => toast({ title: "Sign-in link copied", description: `Send it to ${parent} by WhatsApp, text or email.` }), () => toast({ variant: "destructive", title: "Copy failed", description: parentLink(parent) }));
  const invite = async (parent: string) => {
    try { const r = await m.mutateAsync({ data: { action: "invite", email: parent } }); toast({ title: r.message }); }
    catch (e) { toast({ variant: "destructive", title: "Not sent", description: errorMessage(e) }); }
  };
  const run = async (action: "link" | "unlink", parent: string, studentId: number) => {
    try {
      const r = await m.mutateAsync({ data: { action, email: parent, studentId } });
      toast({ title: r.message });
      await qc.invalidateQueries({ queryKey: getGetParentLinksQueryKey() });
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); return false; }
  };
  const s = search.trim().toLowerCase();
  const parents = useMemo(() => (q.data?.parents ?? []).filter((p) => !s || p.email.includes(s) || p.children.some((c) => `${c.name} ${c.studentId} ${c.className}`.toLowerCase().includes(s))), [q.data, s]);
  const cs = childSearch.trim().toLowerCase();
  const matches = (q.data?.students ?? []).filter((st) => cs.length >= 2 && `${st.name} ${st.studentId} ${st.className}`.toLowerCase().includes(cs)).slice(0, 8);
  const target = email.trim().toLowerCase();
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <ErrorPanel title="Parents did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const unlinked = q.data.students.filter((st) => !st.parents.length).length;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {([["Parents", q.data.parents.length], ["Students with a parent", q.data.students.length - unlinked], ["Students with no parent email", unlinked]] as const).map(([label, n], i) => (
          <div key={label} className="portal-card p-4"><p className={"text-xs font-semibold uppercase tracking-wider " + MUTED}>{label}</p><p className={"mt-1 font-serif text-3xl font-semibold tabular-nums " + (i === 2 && n ? "text-[hsl(var(--p-gold-ink))]" : "")}>{n}</p></div>
        ))}
      </div>

      <section className="portal-card space-y-3 p-5" aria-labelledby="link-title">
        <h2 id="link-title" className="flex items-center gap-2 font-serif text-xl font-semibold"><UserPlus size={18} aria-hidden="true" /> Link a parent to a child</h2>
        <p className={"text-sm " + MUTED}>1. Type the parent's email. 2. Find and link each child. 3. Give the parent their sign-in link. They sign up with this same email and see every linked child.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm font-semibold">Parent's email<input type="email" className="portal-input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" data-testid="input-link-email" /></label>
          <label className="block text-sm font-semibold">Child<input className="portal-input mt-1" value={childSearch} onChange={(e) => setChildSearch(e.target.value)} placeholder="Type a name, Student ID or class" data-testid="input-link-child" /></label>
        </div>
        {EMAIL.test(target) && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="portal-btn-ghost !min-h-[34px] text-sm" onClick={() => void copy(target)} data-testid="button-copy-parent-link"><Copy size={14} aria-hidden="true" /> Copy sign-in link</button>
            <button type="button" className="portal-btn-ghost !min-h-[34px] text-sm" disabled={m.isPending} onClick={() => void invite(target)} data-testid="button-email-parent-link"><Send size={14} aria-hidden="true" /> Email the link</button>
          </div>
        )}
        {matches.length > 0 && (
          <ul className="divide-y divide-[hsl(var(--p-line))] rounded-xl border border-[hsl(var(--p-line))]">
            {matches.map((st: ParentLinkStudent) => {
              const linked = st.parents.includes(target);
              return (
                <li key={st.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1"><b>{st.name}</b> <span className={MUTED}>· {st.studentId} · {st.className}</span><span className={"block text-xs " + MUTED}>{st.parents.length ? `Parents: ${st.parents.join(", ")}` : "No parent linked"}</span></span>
                  {linked ? <StatusPill tone="green">Linked</StatusPill>
                    : <button type="button" className="portal-btn !min-h-[32px] !px-3 text-xs" disabled={!EMAIL.test(target) || st.parents.length >= 2 || m.isPending} title={st.parents.length >= 2 ? "Already has two parents" : undefined} onClick={() => void run("link", target, st.id)} data-testid={`button-link-${st.id}`}><Link2 size={13} aria-hidden="true" /> Link</button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="parents-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="parents-title" className="font-serif text-xl font-semibold">Parents and their children</h2>
          <label className="relative min-w-[14rem]"><span className="sr-only">Search parents</span><Search size={15} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" />
            <input className="portal-input !pl-9" placeholder="Search a parent or child" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-parents-search" /></label>
        </div>
        {!parents.length ? <EmptyState icon={<Users size={22} />} title={q.data.parents.length ? "Nobody matches" : "No parents linked yet"} body="Link a parent's email to their children above." /> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {parents.map((p) => (
              <li key={p.email} className="portal-card p-4" data-testid={`parent-${p.email}`}>
                <p className="break-all font-semibold">{p.email}</p>
                <ul className="mt-2 space-y-1.5">
                  {p.children.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 rounded-lg bg-[hsl(var(--p-paper-2)/0.6)] px-3 py-1.5 text-sm">
                      <span className="min-w-0 flex-1"><b>{c.name}</b> <span className={MUTED}>· {c.studentId} · {c.className}{c.slot === "second" ? " · second parent" : ""}</span></span>
                      <button type="button" className="portal-btn-ghost !min-h-[28px] !px-2 text-xs text-[hsl(var(--p-red))]" disabled={m.isPending} onClick={() => { if (window.confirm(`Unlink ${p.email} from ${c.name}? They will no longer see ${c.name} in the parent portal.`)) void run("unlink", p.email, c.id); }} data-testid={`button-unlink-${c.id}-${p.email}`}><Unlink size={12} aria-hidden="true" /> Unlink</button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                  <button type="button" className={"underline underline-offset-2 " + MUTED} onClick={() => void copy(p.email)} data-testid={`button-copy-link-${p.email}`}>Copy sign-in link</button>
                  <button type="button" className={"underline underline-offset-2 " + MUTED} disabled={m.isPending} onClick={() => void invite(p.email)} data-testid={`button-email-link-${p.email}`}>Email the link</button>
                  <button type="button" className={"underline underline-offset-2 " + MUTED} onClick={() => { setEmail(p.email); setChildSearch(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Link another child</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
