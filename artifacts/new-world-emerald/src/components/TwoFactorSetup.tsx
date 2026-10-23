import { useClerk } from "@clerk/react";
import { KeyRound, RefreshCw } from "lucide-react";

/**
 * Shown to an approved administrator whose account does not yet have two-factor
 * authentication, when the school requires it. Clerk's profile handles setup.
 */
export function TwoFactorSetup({ onCheckAgain, checking, tone = "dark" }: { onCheckAgain: () => void; checking?: boolean; tone?: "dark" | "portal" }) {
  const { openUserProfile } = useClerk();
  const muted = tone === "dark" ? "text-white/70" : "text-[hsl(var(--p-ink)/0.7)]";
  return (
    <div className="text-left" data-testid="panel-two-factor-setup">
      <p className={"text-sm leading-relaxed " + muted}>Your account is approved. The school requires two-factor authentication for administrators, so turn it on to continue.</p>
      <ol className={"mt-4 list-decimal space-y-1.5 pl-5 text-sm " + muted}>
        <li>Click <b>Set up two-factor</b> and open <b>Security</b>.</li>
        <li>Add an <b>authenticator app</b> and scan the QR code with Google Authenticator or Microsoft Authenticator.</li>
        <li>Save your <b>backup codes</b> somewhere safe, then come back and click <b>Check again</b>.</li>
      </ol>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => openUserProfile()} className={tone === "dark" ? "inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 font-bold text-secondary hover:bg-accent/90" : "portal-btn"} data-testid="button-setup-two-factor">
          <KeyRound size={16} /> Set up two-factor
        </button>
        <button type="button" onClick={onCheckAgain} disabled={checking} className={tone === "dark" ? "inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-4 py-3 font-semibold text-white hover:bg-white/10 disabled:opacity-60" : "portal-btn-ghost justify-center"} data-testid="button-check-two-factor">
          <RefreshCw size={15} className={checking ? "animate-spin" : ""} /> {checking ? "Checking..." : "Check again"}
        </button>
      </div>
    </div>
  );
}
