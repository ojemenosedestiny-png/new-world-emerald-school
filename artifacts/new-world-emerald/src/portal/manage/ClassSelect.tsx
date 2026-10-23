import type { ClassItem } from "./useCommand";

export function ClassSelect({ id, value, onChange, classes, disabled }: { id: string; value: number; onChange: (v: number) => void; classes: ClassItem[]; disabled?: boolean }) {
  return (
    <select id={id} className="portal-input" value={value || ""} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} data-testid={"select-" + id}>
      <option value="" disabled>Choose a class</option>
      {classes.filter((c) => c.id != null).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
