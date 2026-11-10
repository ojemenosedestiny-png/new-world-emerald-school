import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { yearGroup } from "./ExamEditor";

type Cls = { id?: number | null; name: string };

/** Move one student to another class: the same year group's classes are listed first (Year 11 A to Year 11 B). */
export function MoveStudentDialog({ student, classes, pending, onMove, onClose }: {
  student: { id: number; name: string; classId: number } | null; classes: Cls[]; pending: boolean;
  onMove: (toClassId: number) => Promise<boolean>; onClose: () => void;
}) {
  const [to, setTo] = useState(0);
  const current = classes.find((c) => c.id === student?.classId);
  const others = classes.filter((c) => c.id !== student?.classId);
  const group = current ? yearGroup(current.name) : "";
  const same = others.filter((c) => group && yearGroup(c.name) === group);
  const rest = others.filter((c) => !same.includes(c));
  const close = () => { setTo(0); onClose(); };
  const target = classes.find((c) => c.id === to);
  return (
    <Dialog open={!!student} onOpenChange={(o) => !o && close()}>
      <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Move {student?.name}</DialogTitle>
          <DialogDescription>Now in <b>{current?.name ?? "no class"}</b>. Their sign-in, past exams and saved results stay with them; from now on they see the new class's exams, notes and timetable.</DialogDescription>
        </DialogHeader>
        <label className="block text-sm font-semibold">Move to
          <select className="portal-input mt-1" value={to || ""} onChange={(e) => setTo(Number(e.target.value))} data-testid="select-move-class">
            <option value="" disabled>Choose the new class</option>
            {same.length > 0 && <optgroup label="Same year">{same.map((c) => <option key={c.id} value={c.id!}>{c.name}</option>)}</optgroup>}
            {rest.length > 0 && <optgroup label={same.length ? "Other classes" : "Classes"}>{rest.map((c) => <option key={c.id} value={c.id!}>{c.name}</option>)}</optgroup>}
          </select>
        </label>
        <DialogFooter className="gap-2">
          <button className="portal-btn-ghost" onClick={close}>Cancel</button>
          <button className="portal-btn" disabled={!to || pending} onClick={async () => { if (await onMove(to)) close(); }} data-testid="button-confirm-move">
            <ArrowRightLeft size={15} /> {pending ? "Moving..." : target ? `Move to ${target.name}` : "Move"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
