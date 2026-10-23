import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChangePortalPassword, getGetPortalSessionQueryKey } from "@workspace/api-client-react";
import { Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ErrorPanel } from "./ui";
import { PasswordStrength, passwordProblem } from "./PasswordStrength";
import { errorMessage } from "./lib";

export function PasswordChange({ required, onDone }: { required: boolean; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const change = useChangePortalPassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const tooShort = next.length > 0 && passwordProblem(next) !== null;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsOld = next.length > 0 && next === current;
  const valid = current.length > 0 && passwordProblem(next) === null && next === confirm && !sameAsOld;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    change.mutate(
      { data: { currentPassword: current, newPassword: next } },
      {
        onSuccess: async () => {
          setCurrent(""); setNext(""); setConfirm("");
          toast({ title: "Password updated", description: "Use your new password next time you sign in." });
          await queryClient.invalidateQueries({ queryKey: getGetPortalSessionQueryKey() });
          onDone?.();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {required && (
        <div className="rounded-2xl bg-[hsl(var(--p-gold-soft))] p-4 text-sm leading-relaxed">
          <p className="font-semibold">Choose your own password first</p>
          <p className="mt-1 text-[hsl(var(--p-ink)/0.75)]">You signed in with a temporary password from the school. Set a private one of at least 10 characters, with letters and numbers, before you continue.</p>
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="pw-current" className="portal-label">{required ? "Temporary password" : "Current password"}</label>
        <input id="pw-current" type="password" className="portal-input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="input-current-password" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="pw-new" className="portal-label">New password</label>
        <input id="pw-new" type="password" className="portal-input" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={tooShort || sameAsOld} aria-describedby="pw-new-hint" data-testid="input-new-password" />
        {sameAsOld ? <p id="pw-new-hint" className="text-xs text-[hsl(var(--p-red))]">Your new password must be different.</p> : <div id="pw-new-hint"><PasswordStrength password={next} /></div>}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="pw-confirm" className="portal-label">Type it again</label>
        <input id="pw-confirm" type="password" className="portal-input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} data-testid="input-confirm-password" />
        {mismatch && <p className="text-xs text-[hsl(var(--p-red))]">The two passwords do not match.</p>}
      </div>
      {change.isError && <ErrorPanel title="Password not changed" message={errorMessage(change.error)} />}
      <button type="submit" className="portal-btn w-full" disabled={!valid || change.isPending} data-testid="button-change-password">
        <Lock size={16} /> {change.isPending ? "Saving..." : "Save new password"}
      </button>
    </form>
  );
}
