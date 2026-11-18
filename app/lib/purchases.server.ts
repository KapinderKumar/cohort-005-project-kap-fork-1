import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import {
  coupons,
  courses,
  enrollments,
  purchases,
  teamMembers,
  teams,
  TeamMemberRole,
} from "~/db/schema";
import { findEnrollment } from "~/lib/enrollments.server";
import type { Db } from "~/lib/refunds.server";

// ─── Purchases ───
// Confirming a Purchase. An Individual Purchase enrolls the buyer. A Team
// Licence grants Seats instead, and does not enroll the buyer.
//
// Every function takes the database first, so tests can hand in an in-memory
// one.

function createPurchase(
  db: Db,
  userId: number,
  courseId: number,
  amountPaid: number,
  country: string | null
) {
  return db
    .insert(purchases)
    .values({ userId, courseId, amountPaid, country })
    .returning()
    .get();
}

export function confirmIndividualPurchase(
  db: Db,
  userId: number,
  courseId: number,
  amountPaid: number,
  country: string | null
) {
  if (findEnrollment(db, userId, courseId)) {
    throw new Error("User is already enrolled in this course");
  }

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) {
    throw new Error("Course not found");
  }

  const purchase = createPurchase(db, userId, courseId, amountPaid, country);
  const enrollment = db
    .insert(enrollments)
    .values({ userId, courseId })
    .returning()
    .get();

  return { purchase, enrollment };
}

function getTeamForAdmin(db: Db, userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();

  if (!membership) return undefined;

  return db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
}

function getOrCreateTeamForUser(db: Db, userId: number) {
  const existingTeam = getTeamForAdmin(db, userId);
  if (existingTeam) return existingTeam;

  const team = db.insert(teams).values({}).returning().get();
  db.insert(teamMembers)
    .values({ teamId: team.id, userId, role: TeamMemberRole.Admin })
    .returning()
    .get();
  return team;
}

function generateSeats(
  db: Db,
  teamId: number,
  courseId: number,
  purchaseId: number,
  quantity: number
) {
  const created: (typeof coupons.$inferSelect)[] = [];
  for (let i = 0; i < quantity; i++) {
    const seat = db
      .insert(coupons)
      .values({
        teamId,
        courseId,
        code: crypto.randomBytes(12).toString("base64url"),
        purchaseId,
      })
      .returning()
      .get();
    created.push(seat);
  }
  return created;
}

export function confirmTeamPurchase(
  db: Db,
  userId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  quantity: number
) {
  const purchase = createPurchase(db, userId, courseId, amountPaid, country);
  const team = getOrCreateTeamForUser(db, userId);
  const seats = generateSeats(db, team.id, courseId, purchase.id, quantity);
  return { purchase, team, seats };
}
