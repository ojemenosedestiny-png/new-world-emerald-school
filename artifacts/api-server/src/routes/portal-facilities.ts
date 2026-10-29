import { Router, type Request } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db, portalClasses, portalHostelAllocations, portalHostelBlocks, portalHostelRooms, portalStudents, portalTransportAssignments, portalTransportRoutes,
} from "@workspace/db";
import { ManageFacilitiesBody } from "@workspace/api-zod";
import { check, portalActor, studentOnly } from "../lib/portal-auth";
import { allocationProblem, roomProblem, roomStatus, safeImageUrl, stopsProblem, validPhone } from "../lib/facilities";

export const portalFacilitiesRouter = Router();

async function officeOnly(req: Request) {
  const actor = await portalActor(req);
  check(actor.role === "admin", actor.role === "guest" ? "Sign in as an administrator." : "Only the school office manages hostels and transport.", actor.role === "guest" ? 401 : 403);
  return actor;
}

portalFacilitiesRouter.get("/facilities", async (req, res) => {
  await officeOnly(req);
  const [blocks, rooms, allocations, routes, assignments, students, classes] = await Promise.all([
    db.select().from(portalHostelBlocks).orderBy(asc(portalHostelBlocks.name)), db.select().from(portalHostelRooms).orderBy(asc(portalHostelRooms.name)),
    db.select().from(portalHostelAllocations), db.select().from(portalTransportRoutes).orderBy(asc(portalTransportRoutes.name)), db.select().from(portalTransportAssignments),
    db.select({ id: portalStudents.id, studentCode: portalStudents.studentId, name: portalStudents.name, classId: portalStudents.classId, active: portalStudents.active }).from(portalStudents).orderBy(asc(portalStudents.name)),
    db.select().from(portalClasses),
  ]);
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const byId = new Map(students.map((s) => [s.id, s]));
  const person = (studentId: number, detail: string) => {
    const s = byId.get(studentId);
    return { studentId, studentCode: s?.studentCode ?? "", name: s?.name ?? "Student", className: s ? className.get(s.classId) ?? "" : "", detail };
  };
  res.json({
    blocks: blocks.map((b) => ({
      ...b, gender: b.gender as "mixed",
      rooms: rooms.filter((r) => r.blockId === b.id).map((r) => {
        const occupants = allocations.filter((a) => a.roomId === r.id).map((a) => person(a.studentId, a.bed));
        return { ...r, occupants, status: roomStatus(r.beds, occupants.length) };
      }),
    })),
    routes: routes.map((r) => ({ ...r, riders: assignments.filter((a) => a.routeId === r.id).map((a) => person(a.studentId, a.stop)) })),
    students: students.filter((s) => s.active).map((s) => ({ id: s.id, studentCode: s.studentCode, name: s.name, className: className.get(s.classId) ?? "" })),
  });
});

async function activeStudent(id: number) {
  const [s] = await db.select({ id: portalStudents.id, active: portalStudents.active }).from(portalStudents).where(eq(portalStudents.id, id));
  check(s && s.active, "Student not found.", 404);
}

portalFacilitiesRouter.post("/facilities", async (req, res) => {
  await officeOnly(req);
  const body = ManageFacilitiesBody.parse(req.body);
  let message = "Saved.";
  switch (body.action) {
    case "saveBlock": {
      const b = body.block;
      check(b, "Block details required.");
      check(b.name.trim(), "Give the block a name.");
      check(safeImageUrl(b.imageUrl.trim()), "Use an uploaded photo or an https:// link.");
      const values = { name: b.name.trim(), gender: b.gender, description: b.description.trim(), imageUrl: b.imageUrl.trim() };
      const [clash] = await db.select({ id: portalHostelBlocks.id }).from(portalHostelBlocks).where(eq(portalHostelBlocks.name, values.name));
      check(!clash || clash.id === b.id, "A block with that name already exists.", 409);
      if (b.id) check((await db.update(portalHostelBlocks).set(values).where(eq(portalHostelBlocks.id, b.id)).returning()).length, "Block not found.", 404);
      else await db.insert(portalHostelBlocks).values(values);
      message = b.id ? "Block updated." : "Block added.";
      break;
    }
    case "deleteBlock": {
      check(body.id, "Block required.");
      const rooms = await db.select({ id: portalHostelRooms.id }).from(portalHostelRooms).where(eq(portalHostelRooms.blockId, body.id));
      const [taken] = rooms.length ? await db.select({ id: portalHostelAllocations.id }).from(portalHostelAllocations).where(inArray(portalHostelAllocations.roomId, rooms.map((r) => r.id))).limit(1) : [];
      check(!taken, "Students are allocated in this block. Move them out first.", 409);
      check((await db.delete(portalHostelBlocks).where(eq(portalHostelBlocks.id, body.id)).returning()).length, "Block not found.", 404);
      message = "Block removed.";
      break;
    }
    case "saveRoom": {
      const r = body.room;
      check(r, "Room details required.");
      const [block] = await db.select({ id: portalHostelBlocks.id }).from(portalHostelBlocks).where(eq(portalHostelBlocks.id, r.blockId));
      check(block, "Block not found.", 404);
      const occupied = r.id ? (await db.select({ id: portalHostelAllocations.id }).from(portalHostelAllocations).where(eq(portalHostelAllocations.roomId, r.id))).length : 0;
      const problem = roomProblem(r, occupied) ?? (safeImageUrl(r.imageUrl.trim()) ? null : "Use an uploaded photo or an https:// link.");
      check(!problem, problem ?? "");
      const values = { blockId: r.blockId, name: r.name.trim(), beds: r.beds, priceKobo: r.priceKobo, imageUrl: r.imageUrl.trim(), notes: r.notes.trim() };
      const [clash] = await db.select({ id: portalHostelRooms.id }).from(portalHostelRooms).where(and(eq(portalHostelRooms.blockId, r.blockId), eq(portalHostelRooms.name, values.name)));
      check(!clash || clash.id === r.id, "That room already exists in this block.", 409);
      if (r.id) check((await db.update(portalHostelRooms).set(values).where(eq(portalHostelRooms.id, r.id)).returning()).length, "Room not found.", 404);
      else await db.insert(portalHostelRooms).values(values);
      message = r.id ? "Room updated." : "Room added.";
      break;
    }
    case "deleteRoom": {
      check(body.id, "Room required.");
      const [taken] = await db.select({ id: portalHostelAllocations.id }).from(portalHostelAllocations).where(eq(portalHostelAllocations.roomId, body.id)).limit(1);
      check(!taken, "Students are allocated to this room. Move them out first.", 409);
      check((await db.delete(portalHostelRooms).where(eq(portalHostelRooms.id, body.id)).returning()).length, "Room not found.", 404);
      message = "Room removed.";
      break;
    }
    case "allocate": {
      const a = body.allocation;
      check(a, "Allocation required.");
      await activeStudent(a.studentId);
      await db.transaction(async (tx) => {
        const [room] = await tx.select().from(portalHostelRooms).where(eq(portalHostelRooms.id, a.roomId)).for("update");
        check(room, "Room not found.", 404);
        const occupants = await tx.select().from(portalHostelAllocations).where(eq(portalHostelAllocations.roomId, room.id));
        const problem = allocationProblem(room, occupants, a.studentId, a.bed);
        check(!problem, problem ?? "", 409);
        await tx.insert(portalHostelAllocations).values({ roomId: room.id, studentId: a.studentId, bed: a.bed.trim() })
          .onConflictDoUpdate({ target: portalHostelAllocations.studentId, set: { roomId: room.id, bed: a.bed.trim(), allocatedAt: new Date() } });
      });
      message = "Student allocated.";
      break;
    }
    case "unallocate": {
      check(body.id, "Student required.");
      check((await db.delete(portalHostelAllocations).where(eq(portalHostelAllocations.studentId, body.id)).returning()).length, "That student has no room.", 404);
      message = "Student moved out.";
      break;
    }
    case "saveRoute": {
      const r = body.route;
      check(r, "Route details required.");
      const stops = r.stops.map((s) => ({ name: s.name.trim(), pickup: s.pickup.trim(), dropoff: s.dropoff.trim() }));
      const problem = (r.name.trim() ? null : "Give the route a name.") ?? stopsProblem(stops) ?? (validPhone(r.driverPhone) ? null : "Enter the driver's phone number, e.g. 0803 123 4567.");
      check(!problem, problem ?? "");
      const values = { name: r.name.trim(), stops, driverName: r.driverName.trim(), driverPhone: r.driverPhone.trim(), vehicle: r.vehicle.trim(), plate: r.plate.trim().toUpperCase(), feeKobo: r.feeKobo, notes: r.notes.trim(), active: r.active };
      const [clash] = await db.select({ id: portalTransportRoutes.id }).from(portalTransportRoutes).where(eq(portalTransportRoutes.name, values.name));
      check(!clash || clash.id === r.id, "A route with that name already exists.", 409);
      if (r.id) {
        const names = new Set(stops.map((s) => s.name.toLowerCase()));
        const riders = await db.select().from(portalTransportAssignments).where(eq(portalTransportAssignments.routeId, r.id));
        check(riders.every((a) => !a.stop || names.has(a.stop.toLowerCase())), "Some students use a stop you removed. Change their stop first.", 409);
        check((await db.update(portalTransportRoutes).set(values).where(eq(portalTransportRoutes.id, r.id)).returning()).length, "Route not found.", 404);
      } else await db.insert(portalTransportRoutes).values(values);
      message = r.id ? "Route updated." : "Route added.";
      break;
    }
    case "deleteRoute": {
      check(body.id, "Route required.");
      const [rider] = await db.select({ id: portalTransportAssignments.id }).from(portalTransportAssignments).where(eq(portalTransportAssignments.routeId, body.id)).limit(1);
      check(!rider, "Students are assigned to this route. Move them first.", 409);
      check((await db.delete(portalTransportRoutes).where(eq(portalTransportRoutes.id, body.id)).returning()).length, "Route not found.", 404);
      message = "Route removed.";
      break;
    }
    case "assignRoute": {
      const a = body.assignment;
      check(a, "Assignment required.");
      await activeStudent(a.studentId);
      const [route] = await db.select().from(portalTransportRoutes).where(eq(portalTransportRoutes.id, a.routeId));
      check(route, "Route not found.", 404);
      check(route.active, "This route is not running. Turn it on first.", 409);
      const stop = route.stops.find((s) => s.name.toLowerCase() === a.stop.trim().toLowerCase());
      check(stop, "Choose one of the route's stops.");
      await db.insert(portalTransportAssignments).values({ routeId: route.id, studentId: a.studentId, stop: stop.name })
        .onConflictDoUpdate({ target: portalTransportAssignments.studentId, set: { routeId: route.id, stop: stop.name, assignedAt: new Date() } });
      message = "Student assigned to the route.";
      break;
    }
    case "unassignRoute": {
      check(body.id, "Student required.");
      check((await db.delete(portalTransportAssignments).where(eq(portalTransportAssignments.studentId, body.id)).returning()).length, "That student has no route.", 404);
      message = "Student removed from the route.";
      break;
    }
  }
  res.json({ message });
});

portalFacilitiesRouter.get("/my-facilities", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const [alloc] = await db.select({ a: portalHostelAllocations, r: portalHostelRooms, b: portalHostelBlocks }).from(portalHostelAllocations)
    .innerJoin(portalHostelRooms, eq(portalHostelRooms.id, portalHostelAllocations.roomId)).innerJoin(portalHostelBlocks, eq(portalHostelBlocks.id, portalHostelRooms.blockId))
    .where(eq(portalHostelAllocations.studentId, student.id));
  const roommates = alloc ? (await db.select({ id: portalHostelAllocations.id }).from(portalHostelAllocations).where(eq(portalHostelAllocations.roomId, alloc.r.id))).length - 1 : 0;
  const [ride] = await db.select({ a: portalTransportAssignments, r: portalTransportRoutes }).from(portalTransportAssignments)
    .innerJoin(portalTransportRoutes, eq(portalTransportRoutes.id, portalTransportAssignments.routeId)).where(eq(portalTransportAssignments.studentId, student.id));
  const stop = ride?.r.stops.find((s) => s.name === ride.a.stop);
  // Students see their own room and route only: never who else is in the room or on the bus.
  res.json({
    hostel: alloc ? { block: alloc.b.name, gender: alloc.b.gender, room: alloc.r.name, bed: alloc.a.bed, priceKobo: alloc.r.priceKobo, imageUrl: alloc.r.imageUrl || alloc.b.imageUrl, roommates } : null,
    transport: ride ? { route: ride.r.name, stop: ride.a.stop, pickup: stop?.pickup ?? "", dropoff: stop?.dropoff ?? "", driverName: ride.r.driverName, driverPhone: ride.r.driverPhone, vehicle: ride.r.vehicle, plate: ride.r.plate, feeKobo: ride.r.feeKobo, stops: ride.r.stops } : null,
  });
});
