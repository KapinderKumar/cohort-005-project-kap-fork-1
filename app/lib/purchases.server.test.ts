import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { TeamMemberRole } from "~/db/schema";
import {
  confirmIndividualPurchase,
  confirmTeamPurchase,
} from "./purchases.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

function storedPurchases() {
  return db.select().from(schema.purchases).all();
}

function storedEnrollments() {
  return db.select().from(schema.enrollments).all();
}

function storedSeats() {
  return db.select().from(schema.coupons).all();
}

describe("confirmIndividualPurchase", () => {
  it("records the Purchase and enrolls the buyer", () => {
    const { purchase, enrollment } = confirmIndividualPurchase(
      db,
      base.user.id,
      base.course.id,
      7900,
      "IN"
    );

    expect(purchase).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 7900,
      country: "IN",
    });
    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
    });
    expect(storedPurchases()).toHaveLength(1);
    expect(storedEnrollments()).toHaveLength(1);
  });

  it("creates no Seats", () => {
    confirmIndividualPurchase(db, base.user.id, base.course.id, 7900, null);

    expect(storedSeats()).toHaveLength(0);
  });

  it("rejects a buyer who is already enrolled, recording nothing new", () => {
    confirmIndividualPurchase(db, base.user.id, base.course.id, 7900, null);

    expect(() =>
      confirmIndividualPurchase(db, base.user.id, base.course.id, 7900, null)
    ).toThrow("User is already enrolled in this course");
    expect(storedPurchases()).toHaveLength(1);
    expect(storedEnrollments()).toHaveLength(1);
  });

  it("rejects a course that does not exist, recording nothing", () => {
    expect(() =>
      confirmIndividualPurchase(db, base.user.id, 9999, 7900, null)
    ).toThrow("Course not found");
    expect(storedPurchases()).toHaveLength(0);
    expect(storedEnrollments()).toHaveLength(0);
  });
});

describe("confirmTeamPurchase", () => {
  it("does not enroll the buyer", () => {
    confirmTeamPurchase(db, base.user.id, base.course.id, 15800, "IN", 2);

    expect(storedEnrollments()).toHaveLength(0);
  });

  it("grants the requested number of Unclaimed Seats", () => {
    const { purchase, team } = confirmTeamPurchase(
      db,
      base.user.id,
      base.course.id,
      23700,
      "IN",
      3
    );

    expect(purchase).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 23700,
      country: "IN",
    });
    const seats = storedSeats();
    expect(seats).toHaveLength(3);
    expect(new Set(seats.map((seat) => seat.code)).size).toBe(3);
    for (const seat of seats) {
      expect(seat).toMatchObject({
        teamId: team.id,
        courseId: base.course.id,
        purchaseId: purchase.id,
        redeemedByUserId: null,
        redeemedAt: null,
      });
    }
  });

  it("makes the buyer the Team Admin of a new team", () => {
    const { team } = confirmTeamPurchase(
      db,
      base.user.id,
      base.course.id,
      7900,
      null,
      1
    );

    expect(db.select().from(schema.teamMembers).all()).toEqual([
      expect.objectContaining({
        teamId: team.id,
        userId: base.user.id,
        role: TeamMemberRole.Admin,
      }),
    ]);
  });

  it("reuses the team the buyer already administers", () => {
    const first = confirmTeamPurchase(
      db,
      base.user.id,
      base.course.id,
      7900,
      null,
      1
    );
    const second = confirmTeamPurchase(
      db,
      base.user.id,
      base.course.id,
      7900,
      null,
      1
    );

    expect(second.team.id).toBe(first.team.id);
    expect(db.select().from(schema.teams).all()).toHaveLength(1);
  });

  it("lets an enrolled buyer buy Seats for others", () => {
    confirmIndividualPurchase(db, base.user.id, base.course.id, 7900, null);

    confirmTeamPurchase(db, base.user.id, base.course.id, 7900, null, 1);

    expect(storedPurchases()).toHaveLength(2);
    expect(storedEnrollments()).toHaveLength(1);
    expect(storedSeats()).toHaveLength(1);
  });

  it("rejects a course that does not exist, recording nothing", () => {
    expect(() =>
      confirmTeamPurchase(db, base.user.id, 9999, 7900, null, 1)
    ).toThrow();
    expect(storedPurchases()).toHaveLength(0);
    expect(storedSeats()).toHaveLength(0);
  });
});
