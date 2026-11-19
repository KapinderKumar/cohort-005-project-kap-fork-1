import { and, eq } from "drizzle-orm";
import { courses, enrollments, users } from "~/db/schema";
import type { Notification } from "~/lib/notifier.server";
import type { Db } from "~/lib/refunds.server";

export function findEnrollment(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/** Tells the Instructor about an Enrollment, whichever way it came about. */
export function buildNewEnrollmentNotification(
  student: typeof users.$inferSelect,
  course: typeof courses.$inferSelect
): Notification {
  return {
    type: "new_enrollment",
    actorId: student.id,
    recipientIds: [course.instructorId],
    title: "New enrollment",
    body: `${student.name} enrolled in ${course.title}.`,
    url: `/instructor/${course.id}/students`,
  };
}
