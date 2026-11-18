import { and, eq } from "drizzle-orm";
import { enrollments } from "~/db/schema";
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
