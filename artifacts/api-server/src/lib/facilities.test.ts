import assert from "node:assert/strict";
import { test } from "node:test";
import { allocationProblem, roomProblem, roomStatus, safeImageUrl, stopsProblem, validPhone } from "./facilities";

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
