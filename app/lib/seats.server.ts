import { and, asc, eq } from "drizzle-orm";
import {
  coupons,
  courses,
  enrollments,
  purchases,
  teamMembers,
  users,
  TeamMemberRole,
} from "~/db/schema";
import {
  buildNewEnrollmentNotification,
  findEnrollment,
} from "~/lib/enrollments.server";
import type { Notification } from "~/lib/notifier.server";
import {
  getSeatAvailability,
  type Db,
  type SeatAvailability,
} from "~/lib/refunds.server";

// ─── Seats ───
// Claiming a Seat on a Team Licence, which enrolls the person claiming it.
//
// Every function takes the database first, so tests can hand in an in-memory
// one.

const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

export function seatUnavailableReason(
  availability: SeatAvailability
): string | null {
  if (availability === "on_hold") return SEAT_ON_HOLD;
  if (availability === "refunded") return SEAT_REFUNDED;
  return null;
}

export type ClaimSeatResult =
  | {
      ok: true;
      enrollment: typeof enrollments.$inferSelect;
      notifications: Notification[];
    }
  | { ok: false; error: string };

export function claimSeat(
  db: Db,
  code: string,
  userId: number,
  userCountry: string
): ClaimSeatResult {
  const seat = db.select().from(coupons).where(eq(coupons.code, code)).get();
  if (!seat) {
    return { ok: false, error: "Coupon not found" };
  }

  if (seat.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  const unavailableReason = seatUnavailableReason(
    getSeatAvailability(db, seat)
  );
  if (unavailableReason) {
    return { ok: false, error: unavailableReason };
  }

  if (findEnrollment(db, userId, seat.courseId)) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, seat.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== userCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, seat.courseId))
    .get();
  if (!course) {
    return { ok: false, error: "Course not found" };
  }

  const student = db.select().from(users).where(eq(users.id, userId)).get();
  if (!student) {
    return { ok: false, error: "User not found" };
  }

  db.update(coupons)
    .set({
      redeemedByUserId: userId,
      redeemedAt: new Date().toISOString(),
    })
    .where(eq(coupons.id, seat.id))
    .run();

  const enrollment = db
    .insert(enrollments)
    .values({ userId, courseId: seat.courseId })
    .returning()
    .get();

  const teamAdmins = db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, seat.teamId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .orderBy(asc(teamMembers.id))
    .all();

  return {
    ok: true,
    enrollment,
    notifications: [
      {
        type: "seat_claimed",
        actorId: userId,
        recipientIds: teamAdmins.map((admin) => admin.userId),
        title: "Seat claimed",
        body: `${student.name} claimed a seat on your ${course.title} Team Licence.`,
        url: "/team",
      },
      buildNewEnrollmentNotification(student, course),
    ],
  };
}
