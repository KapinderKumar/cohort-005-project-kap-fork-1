import { and, eq } from "drizzle-orm";
import { courseRatings, courses } from "~/db/schema";
import { MAX_RATING, MIN_RATING } from "~/lib/ratings";
import type { Db } from "~/lib/refunds.server";

// ─── Course ratings ───
// Saving a person's star rating of a course. Whether they may rate it is the
// route's decision.
//
// Every function takes the database first, so tests can hand in an in-memory
// one.

export function findRating(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(courseRatings)
    .where(
      and(eq(courseRatings.userId, userId), eq(courseRatings.courseId, courseId))
    )
    .get();
}

export function rateCourse(
  db: Db,
  userId: number,
  courseId: number,
  rating: number
) {
  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    throw new Error(
      `Rating must be a whole number between ${MIN_RATING} and ${MAX_RATING}`
    );
  }

  const course = db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();

  if (!course) {
    throw new Error("Course not found");
  }

  const existing = findRating(db, userId, courseId);

  if (existing) {
    return db
      .update(courseRatings)
      .set({ rating, updatedAt: new Date().toISOString() })
      .where(eq(courseRatings.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(courseRatings)
    .values({ userId, courseId, rating })
    .returning()
    .get();
}
