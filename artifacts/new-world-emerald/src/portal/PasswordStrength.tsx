// Mirrors the server rule (lib/accounts.ts passwordProblem): 10+ characters, a letter and a number.
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Include at least one letter and one number.";
  return null;
}

/** 0 (empty) to 4 (strong), from length and character variety. */
export function passwordScore(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  if (passwordProblem(password)) score = Math.min(score, 1);
  return Math.max(1, score);
}

const LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const COLORS = ["", "hsl(var(--p-red))", "hsl(var(--p-gold))", "hsl(var(--p-emerald) / 0.7)", "hsl(var(--p-emerald))"];

export function PasswordStrength({ password }: { password: string }) {
  const score = passwordScore(password);
  const problem = password ? passwordProblem(password) : null;
  return (
    <div aria-live="polite" data-testid="password-strength">
      <div className="mt-1.5 grid grid-cols-4 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => <span key={i} className="h-1.5 rounded-full" style={{ background: i <= score ? COLORS[score] : "hsl(var(--p-line))" }} />)}
      </div>
      <p className="mt-1 text-xs text-[hsl(var(--p-ink)/0.6)]">
        {password ? <><b>{LABELS[score]}</b>{problem ? ` / ${problem}` : score < 4 ? " / longer, with capitals and symbols, is stronger" : ""}</> : "At least 10 characters, with letters and numbers."}
      </p>
    </div>
  );
}
