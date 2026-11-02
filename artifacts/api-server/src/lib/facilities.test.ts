import assert from "node:assert/strict";
import { test } from "node:test";
import { allocationProblem, billingProblem, facilityCharges, roomProblem, roomStatus, safeImageUrl, stopsProblem, validPhone } from "./facilities";

test("hostel: rooms fill up, bed labels are unique, and a room cannot shrink below its occupants", () => {
  assert.equal(roomStatus(4, 3), "available");
  assert.equal(roomStatus(4, 4), "full");
  const occupants = [{ studentId: 1, bed: "Bed 1" }, { studentId: 2, bed: "Bed 2" }];
  assert.match(allocationProblem({ beds: 2 }, occupants, 3, "")!, /full/);
  assert.equal(allocationProblem({ beds: 2 }, occupants, 2, "Bed 2"), null, "moving within the same room is fine");
  assert.match(allocationProblem({ beds: 3 }, occupants, 3, "bed 1")!, /already taken/);
  assert.equal(allocationProblem({ beds: 3 }, occupants, 3, "Bed 3"), null);
  assert.match(roomProblem({ name: "A1", beds: 2, priceKobo: 0 }, 3)!, /Move some out/);
  assert.match(roomProblem({ name: " ", beds: 2, priceKobo: 0 }, 0)!, /name/);
  assert.equal(roomProblem({ name: "A1", beds: 6, priceKobo: 15_000_000 }, 2), null);
});

test("transport: stops need names and proper times; phones and photo links are checked", () => {
  assert.match(stopsProblem([])!, /at least one/);
  assert.match(stopsProblem([{ name: "Gate", pickup: "7.15", dropoff: "" }])!, /07:15/);
  assert.match(stopsProblem([{ name: "Gate", pickup: "", dropoff: "" }, { name: "gate", pickup: "", dropoff: "" }])!, /once/);
  assert.equal(stopsProblem([{ name: "Ikeja", pickup: "06:45", dropoff: "15:40" }, { name: "School", pickup: "07:30", dropoff: "15:00" }]), null);
  assert.equal(validPhone("0803 123 4567"), true);
  assert.equal(validPhone("call me"), false);
  assert.equal(safeImageUrl("https://res.cloudinary.com/x/image.jpg"), true);
  assert.equal(safeImageUrl("/objects/uploads/abc"), true);
  assert.equal(safeImageUrl("javascript:alert(1)"), false);
  assert.equal(safeImageUrl("data:image/png;base64,AAAA"), false);
});

test("hostel and bus fees: one charge per student, term and kind, with a fixed reference; free places are not billed", () => {
  const charges = facilityCharges(" First Term ", "2026/2027", [
    { kind: "hostel", studentCode: "NWE/2026/00014", studentName: "Ada Obi", className: "JSS 2", place: "Emerald House, room 3", amountKobo: 150_000_00 },
    { kind: "bus", studentCode: "NWE/2026/00014", studentName: "Ada Obi", className: "JSS 2", place: "Kubwa route", amountKobo: 40_000_00 },
    { kind: "bus", studentCode: "NWE/2026/00031", studentName: "Ben Eze", className: "SS 1", place: "Free shuttle", amountKobo: 0 },
  ]);
  assert.deepEqual(charges.map((c) => [c.reference, c.description, c.term, c.amountKobo]), [
    ["HOSTEL-2026-2027-FIRST-TERM-NWE-2026-00014", "Hostel: Emerald House, room 3", "First Term", 150_000_00],
    ["BUS-2026-2027-FIRST-TERM-NWE-2026-00014", "School bus: Kubwa route", "First Term", 40_000_00],
  ]);
  // The same term written differently gives the same reference, so it is never billed twice.
  assert.equal(facilityCharges("first term", "2026/2027", [{ kind: "hostel", studentCode: "nwe/2026/00014", studentName: "", className: "", place: "", amountKobo: 1 }])[0].reference, charges[0].reference);
  assert.equal(billingProblem("First Term", "2026/2027", ["hostel"]), null);
  assert.match(billingProblem("First Term", "2026/2028", ["hostel"])!, /2026\/2027/);
  assert.match(billingProblem("", "2026/2027", ["bus"])!, /term/);
  assert.match(billingProblem("First Term", "2026/2027", [])!, /hostel fees, bus fees or both/);
});
