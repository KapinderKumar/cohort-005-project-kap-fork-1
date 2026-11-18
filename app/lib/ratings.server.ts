import { and, eq } from "drizzle-orm";
import { courseRatings, courses, users } from "~/db/schema";
import type { Notification } from "~/lib/notifier.server";
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

function saveRating(
  db: Db,
  existingId: number | undefined,
  userId: number,
  courseId: number,
  rating: number
) {
  if (existingId !== undefined) {
    return db
      .update(courseRatings)
      .set({ rating, updatedAt: new Date().toISOString() })
      .where(eq(courseRatings.id, existingId))
      .returning()
      .get();
  }

  return db
    .insert(courseRatings)
    .values({ userId, courseId, rating })
    .returning()
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
    .select({
      id: courses.id,
      title: courses.title,
      instructorId: courses.instructorId,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();

  if (!course) {
    throw new Error("Course not found");
  }

  const existing = findRating(db, userId, courseId);
  const saved = saveRating(db, existing?.id, userId, courseId, rating);

  // Read after the write, so a missing rater fails where it always has.
  const rater = db.select().from(users).where(eq(users.id, userId)).get();

  // Saving always refreshes updatedAt, so only the values show what changed.
  const notifications: Notification[] =
    !rater || existing?.rating === rating
      ? []
      : [
          {
            type: "course_rated",
            actorId: userId,
            recipientIds: [course.instructorId],
            title: "Course rated",
            body: existing
              ? `${rater.name} changed their rating of ${course.title} from ${existing.rating} to ${rating} out of ${MAX_RATING}.`
              : `${rater.name} rated ${course.title} ${rating} out of ${MAX_RATING}.`,
            url: "/instructor/analytics",
          },
        ];

  return { rating: saved, notifications };
}
