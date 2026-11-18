import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundStatus, TeamMemberRole, UserRole } from "~/db/schema";
import { confirmTeamPurchase } from "./purchases.server";
import { claimSeat, seatUnavailableReason } from "./seats.server";

type TestDb = ReturnType<typeof createTestDb>;

const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let student: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  student = db
    .insert(schema.users)
    .values({
      name: "Sam Student",
      email: "sam@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();
});

function buySeat(country: string | null = "IN") {
  const { purchase, seats } = confirmTeamPurchase(
    db,
    base.user.id,
    base.course.id,
    7900,
    country,
    1
  );
  const [seat] = seats;
  if (!seat) throw new Error("Expected the Team Licence to grant a Seat");
  return { purchase, seat };
}

function storedSeat(seatId: number) {
  return db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, seatId))
    .get();
}

function enrollmentsOf(userId: number) {
  return db
    .select()
    .from(schema.enrollments)
    .where(eq(schema.enrollments.userId, userId))
    .all();
}

function expectNotClaimed(seatId: number) {
  expect(storedSeat(seatId)).toMatchObject({
    redeemedByUserId: null,
    redeemedAt: null,
  });
  expect(enrollmentsOf(student.id)).toHaveLength(0);
}

describe("claimSeat", () => {
  it("claims the Seat and enrolls the Student", () => {
    const { seat } = buySeat();

    const result = claimSeat(db, seat.code, student.id, "IN");

    expect(result).toMatchObject({
      ok: true,
      enrollment: { userId: student.id, courseId: base.course.id },
    });
    const claimed = storedSeat(seat.id);
    expect(claimed?.redeemedByUserId).toBe(student.id);
    expect(claimed?.redeemedAt).not.toBeNull();
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });

  it("allows any country when the Team Licence recorded none", () => {
    const { seat } = buySeat(null);

    expect(claimSeat(db, seat.code, student.id, "US").ok).toBe(true);
  });

  it("rejects a code that does not exist", () => {
    expect(claimSeat(db, "missing", student.id, "IN")).toEqual({
      ok: false,
      error: "Coupon not found",
    });
    expect(enrollmentsOf(student.id)).toHaveLength(0);
  });

  it("rejects a Seat that is already claimed", () => {
    const { seat } = buySeat();
    claimSeat(db, seat.code, base.instructor.id, "IN");

    expect(claimSeat(db, seat.code, student.id, "IN")).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
    expect(storedSeat(seat.id)?.redeemedByUserId).toBe(base.instructor.id);
    expect(enrollmentsOf(student.id)).toHaveLength(0);
  });

  it("rejects a Seat on hold for an Open Refund Request", () => {
    const { purchase, seat } = buySeat();
    db.insert(schema.refunds)
      .values({
        purchaseId: purchase.id,
        status: RefundStatus.Open,
        reason: "Changed our minds",
      })
      .run();

    expect(claimSeat(db, seat.code, student.id, "IN")).toEqual({
      ok: false,
      error: SEAT_ON_HOLD,
    });
    expectNotClaimed(seat.id);
  });

  it("rejects a refunded Seat", () => {
    const { seat } = buySeat();
    db.update(schema.coupons)
      .set({ refundedAt: new Date().toISOString() })
      .where(eq(schema.coupons.id, seat.id))
      .run();

    expect(claimSeat(db, seat.code, student.id, "IN")).toEqual({
      ok: false,
      error: SEAT_REFUNDED,
    });
    expectNotClaimed(seat.id);
  });

  it("rejects a Student already enrolled, leaving the Seat unclaimed", () => {
    const { seat } = buySeat();
    db.insert(schema.enrollments)
      .values({ userId: student.id, courseId: base.course.id })
      .run();

    expect(claimSeat(db, seat.code, student.id, "IN")).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
    expect(storedSeat(seat.id)?.redeemedByUserId).toBeNull();
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });

  it("rejects a Student in a different country from the purchaser", () => {
    const { seat } = buySeat("IN");

    expect(claimSeat(db, seat.code, student.id, "US")).toEqual({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
    expectNotClaimed(seat.id);
  });
});

describe("the Notifications for a claimed Seat", () => {
  it("tells the Team Admin and the Instructor", () => {
    const { seat } = buySeat();

    const result = claimSeat(db, seat.code, student.id, "IN");

    if (!result.ok) throw new Error(result.error);
    expect(result.notifications).toEqual([
      {
        type: "seat_claimed",
        actorId: student.id,
        recipientIds: [base.user.id],
        title: "Seat claimed",
        body: "Sam Student claimed a seat on your Test Course Team Licence.",
        url: "/team",
      },
      {
        type: "new_enrollment",
        actorId: student.id,
        recipientIds: [base.instructor.id],
        title: "New enrollment",
        body: "Sam Student enrolled in Test Course.",
        url: `/instructor/${base.course.id}/students`,
      },
    ]);
  });

  it("tells every Team Admin on the team, and no other member", () => {
    const { seat } = buySeat();
    const addMember = (name: string, role: TeamMemberRole) => {
      const member = db
        .insert(schema.users)
        .values({
          name,
          email: `${name.toLowerCase()}@example.com`,
          role: UserRole.Student,
        })
        .returning()
        .get();
      db.insert(schema.teamMembers)
        .values({ teamId: seat.teamId, userId: member.id, role })
        .run();
      return member;
    };
    const secondAdmin = addMember("Tara", TeamMemberRole.Admin);
    addMember("Milo", TeamMemberRole.Member);

    const result = claimSeat(db, seat.code, student.id, "IN");

    if (!result.ok) throw new Error(result.error);
    expect(result.notifications[0].recipientIds).toEqual([
      base.user.id,
      secondAdmin.id,
    ]);
  });

  it("returns no Notifications when the Seat can't be claimed", () => {
    const { seat } = buySeat("IN");

    const result = claimSeat(db, seat.code, student.id, "US");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("notifications");
  });
});

describe("seatUnavailableReason", () => {
  it("explains a Seat on hold and a refunded Seat", () => {
    expect(seatUnavailableReason("on_hold")).toBe(SEAT_ON_HOLD);
    expect(seatUnavailableReason("refunded")).toBe(SEAT_REFUNDED);
  });

  it("gives no reason for an available or claimed Seat", () => {
    expect(seatUnavailableReason("available")).toBeNull();
    expect(seatUnavailableReason("claimed")).toBeNull();
  });
});
