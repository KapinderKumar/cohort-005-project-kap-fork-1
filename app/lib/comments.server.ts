import { and, eq } from "drizzle-orm";
import {
  comments,
  courses,
  lessons,
  modules,
  users,
  UserRole,
} from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import type { Notification } from "~/lib/notifier.server";
import type { Db } from "~/lib/refunds.server";

// ─── Comments ───
// Posting a comment on a lesson. Who may post is the route's decision: the
// lesson page requires course access, the Unanswered Questions page requires
// the course's Instructor or a Platform Admin.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Failures throw an Error whose message is safe to show the person posting.

export function assertValidCommentBody(body: string) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

// Routes check access against a course, so the lesson is looked up within that
// course: a crafted request can't post on another course's lesson.
function findLessonInCourse(db: Db, courseId: number, lessonId: number) {
  return db
    .select({
      title: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(and(eq(lessons.id, lessonId), eq(courses.id, courseId)))
    .get();
}

export function createComment(
  db: Db,
  userId: number,
  courseId: number,
  lessonId: number,
  parentId: number | null,
  body: string
) {
  const trimmed = assertValidCommentBody(body);

  const lesson = findLessonInCourse(db, courseId, lessonId);
  if (!lesson) {
    throw new Error("Lesson not found");
  }

  let askerId: number | null = null;

  if (parentId !== null) {
    const parent = db
      .select()
      .from(comments)
      .where(eq(comments.id, parentId))
      .get();
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
    askerId = parent.userId;
  }

  const comment = db
    .insert(comments)
    .values({ userId, lessonId, parentId, body: trimmed })
    .returning()
    .get();

  const notifications: Notification[] = [];

  // Read after the write, so a missing author fails where it always has.
  const author = db.select().from(users).where(eq(users.id, userId)).get();
  if (!author) return { comment, notifications };

  const url = `/courses/${lesson.courseSlug}/lessons/${lessonId}#comment-${comment.id}`;

  // A top-level comment by the course's Instructor isn't a Discussion Question.
  if (parentId === null && userId !== lesson.instructorId) {
    notifications.push({
      type: "new_discussion_question",
      actorId: userId,
      recipientIds: [lesson.instructorId],
      title: "New question",
      body: `${author.name} asked a question on ${lesson.title} in ${lesson.courseTitle}.`,
      url,
    });
  }

  // Only a Discussion Reply from the course's Instructor or a Platform Admin is
  // announced, and only on a Discussion Question.
  const isInstructorOrPlatformAdmin =
    userId === lesson.instructorId || author.role === UserRole.Admin;
  if (
    askerId !== null &&
    askerId !== lesson.instructorId &&
    isInstructorOrPlatformAdmin
  ) {
    notifications.push({
      type: "new_discussion_reply",
      actorId: userId,
      recipientIds: [askerId],
      title: "Your question was answered",
      body: `${author.name} answered your question on ${lesson.title} in ${lesson.courseTitle}.`,
      url,
    });
  }

  return { comment, notifications };
}
