import assert from "node:assert/strict";
import { test } from "node:test";
import type { PortalTeacherRecord } from "@workspace/db";
import { cleanSubjects, directoryEntries, eventValues, eventVisible } from "./community";

test("event input is trimmed and checked", () => {
  const ok = eventValues({ title: " Sports ", category: "sports", startsAt: "2026-11-01T09:00:00Z", endsAt: "", allDay: true, published: true });
  assert.ok("values" in ok);
  assert.equal(ok.values.title, "Sports");
  assert.equal(ok.values.endsAt, null, "empty end means no end");
  assert.equal(ok.values.classId, null, "no class means the whole school");
  assert.deepEqual(eventValues({ title: "x", category: "general", startsAt: "soon", allDay: false, published: true }), { error: "Choose when the event starts." });
  assert.ok("error" in eventValues({ title: "x", category: "general", startsAt: "2026-11-02", endsAt: "2026-11-01", allDay: false, published: true }));
});

test("event visibility follows publish state and class", () => {
  assert.equal(eventVisible({ published: true, classId: null }, [3]), true);
  assert.equal(eventVisible({ published: true, classId: 3 }, [3]), true);
  assert.equal(eventVisible({ published: true, classId: 4 }, [3]), false);
  assert.equal(eventVisible({ published: false, classId: null }, [3]), false);
});

test("directory hides inactive, hidden and contact details", () => {
  const t = (over: Partial<PortalTeacherRecord>): PortalTeacherRecord => ({ id: 1, email: "x@y.z", name: "N", classIds: [1, 9], active: true, title: "", subjects: [], showInDirectory: true, photoFileId: null, ...over });
  const rows = directoryEntries([t({ id: 2, name: "Zainab" }), t({ id: 3, name: "Ade", title: "Head" }), t({ id: 4, active: false }), t({ id: 5, showInDirectory: false })], new Map([[1, "JSS 1"]]));
  assert.deepEqual(rows.map((r) => r.id), [3, 2]);
  assert.deepEqual(rows[0], { id: 3, name: "Ade", title: "Head", subjects: [], classNames: ["JSS 1"], photoId: null });
  assert.deepEqual(cleanSubjects([" Maths", "maths", "", "English"]), ["Maths", "English"]);
  assert.equal(cleanSubjects(undefined), undefined);
});
