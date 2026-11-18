import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { createComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;
let platformAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  const addLesson = (position: number) =>
    db
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: `Lesson ${position}`, position })
      .returning()
      .get().id;

  lessonId = addLesson(1);
  otherLessonId = addLesson(2);
});

function storedComments() {
  return db.select().from(schema.comments).all();
}

function post(
  userId: number,
  parentId: number | null,
  body: string,
  onLessonId = lessonId
) {
  return createComment(db, userId, base.course.id, onLessonId, parentId, body);
}

function addCourseWithLesson() {
  const instructor = db
    .insert(schema.users)
    .values({
      name: "Other Instructor",
      email: "other-instructor@example.com",
      role: UserRole.Instructor,
    })
    .returning()
    .get();
  const course = db
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Another course",
      salesCopy: "Another course",
      instructorId: instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
  const module = db
    .insert(schema.modules)
    .values({ courseId: course.id, title: "Other", position: 1 })
    .returning()
    .get();
  const lesson = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Other lesson", position: 1 })
    .returning()
    .get();
  return { course, lesson };
}

describe("createComment", () => {
  it("posts a top-level comment with its body trimmed", () => {
    const { comment } = post(base.user.id, null, "  How does this work?  ");

    expect(comment).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "How does this work?",
    });
    expect(storedComments()).toHaveLength(1);
  });

  it("posts a reply to a top-level comment", () => {
    const { comment: question } = post(base.user.id, null, "Why?");

    const { comment: reply } = post(base.instructor.id, question.id, "Because.");

    expect(reply.parentId).toBe(question.id);
    expect(storedComments()).toHaveLength(2);
  });

  it("accepts a body of exactly 5000 characters", () => {
    const { comment } = post(base.user.id, null, "a".repeat(5000));

    expect(comment.body).toHaveLength(5000);
  });

  it("rejects a body that is only whitespace", () => {
    expect(() => post(base.user.id, null, "   \n ")).toThrow(
      "Comment cannot be empty"
    );
    expect(storedComments()).toHaveLength(0);
  });

  it("rejects a body over 5000 characters", () => {
    expect(() => post(base.user.id, null, "a".repeat(5001))).toThrow(
      "Comment must be 5000 characters or fewer"
    );
    expect(storedComments()).toHaveLength(0);
  });

  it("rejects a lesson that does not exist", () => {
    expect(() => post(base.user.id, null, "Hello", 9999)).toThrow(
      "Lesson not found"
    );
    expect(storedComments()).toHaveLength(0);
  });

  it("rejects a lesson that belongs to another course", () => {
    const { lesson } = addCourseWithLesson();

    expect(() => post(base.user.id, null, "Hello", lesson.id)).toThrow(
      "Lesson not found"
    );
    expect(storedComments()).toHaveLength(0);
  });

  it("rejects a parent comment that does not exist", () => {
    expect(() => post(base.user.id, 9999, "Hello")).toThrow(
      "Parent comment not found"
    );
    expect(storedComments()).toHaveLength(0);
  });

  it("fails at the write for an author who doesn't exist, as it always has", () => {
    expect(() => post(9999, null, "Hello")).toThrow(
      "FOREIGN KEY constraint failed"
    );
    expect(storedComments()).toHaveLength(0);
  });

  it("reports a bad parent comment before noticing a missing author", () => {
    expect(() => post(9999, 8888, "Hello")).toThrow("Parent comment not found");
  });

  it("rejects a parent comment on a different lesson", () => {
    const { comment: question } = post(
      base.user.id,
      null,
      "Why?",
      otherLessonId
    );

    expect(() => post(base.instructor.id, question.id, "Because.")).toThrow(
      "Parent comment belongs to a different lesson"
    );
    expect(storedComments()).toHaveLength(1);
  });

  it("rejects a reply to a reply", () => {
    const { comment: question } = post(base.user.id, null, "Why?");
    const { comment: reply } = post(base.instructor.id, question.id, "Because.");

    expect(() => post(base.user.id, reply.id, "But why?")).toThrow(
      "Replies can only be one level deep"
    );
    expect(storedComments()).toHaveLength(2);
  });
});

describe("the Notification for a Discussion Question", () => {
  it("tells the course's Instructor and links to the comment", () => {
    const { comment, notifications } = post(base.user.id, null, "Why?");

    expect(notifications).toEqual([
      {
        type: "new_discussion_question",
        actorId: base.user.id,
        recipientIds: [base.instructor.id],
        title: "New question",
        body: "Test User asked a question on Lesson 1 in Test Course.",
        url: `/courses/test-course/lessons/${lessonId}#comment-${comment.id}`,
      },
    ]);
  });

  it("tells the Instructor when a Platform Admin asks", () => {
    const { notifications } = post(platformAdmin.id, null, "Why?");

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "new_discussion_question",
      actorId: platformAdmin.id,
      recipientIds: [base.instructor.id],
      body: "Pat Admin asked a question on Lesson 1 in Test Course.",
    });
  });

  it("is not sent for the Instructor's own top-level comment", () => {
    expect(post(base.instructor.id, null, "A tip.").notifications).toEqual([]);
  });

  it("never contains the text of the question", () => {
    const { notifications } = post(base.user.id, null, "PRIVATE-QUESTION");

    expect(JSON.stringify(notifications)).not.toContain("PRIVATE-QUESTION");
  });
});

describe("the Notification for a Discussion Reply", () => {
  it("tells the person who asked when the Instructor replies", () => {
    const { comment: question } = post(base.user.id, null, "Why?");

    const { comment: reply, notifications } = post(
      base.instructor.id,
      question.id,
      "Because."
    );

    expect(notifications).toEqual([
      {
        type: "new_discussion_reply",
        actorId: base.instructor.id,
        recipientIds: [base.user.id],
        title: "Your question was answered",
        body: "Test Instructor answered your question on Lesson 1 in Test Course.",
        url: `/courses/test-course/lessons/${lessonId}#comment-${reply.id}`,
      },
    ]);
  });

  it("tells the person who asked when a Platform Admin replies", () => {
    const { comment: question } = post(base.user.id, null, "Why?");

    const { notifications } = post(platformAdmin.id, question.id, "Because.");

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "new_discussion_reply",
      actorId: platformAdmin.id,
      recipientIds: [base.user.id],
      body: "Pat Admin answered your question on Lesson 1 in Test Course.",
    });
  });

  it("is not sent when another Student replies", () => {
    const otherStudent = db
      .insert(schema.users)
      .values({
        name: "Sam Student",
        email: "sam@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();
    const { comment: question } = post(base.user.id, null, "Why?");

    const { notifications } = post(otherStudent.id, question.id, "No idea.");

    expect(notifications).toEqual([]);
  });

  it("is not sent when a Platform Admin replies to the Instructor's own comment", () => {
    const { comment: tip } = post(base.instructor.id, null, "A tip.");

    const { notifications } = post(platformAdmin.id, tip.id, "Nice.");

    expect(notifications).toEqual([]);
  });

  it("leaves removing the actor to sending", () => {
    const { comment: question } = post(platformAdmin.id, null, "Why?");

    const { notifications } = post(platformAdmin.id, question.id, "Found it.");

    expect(notifications[0]).toMatchObject({
      actorId: platformAdmin.id,
      recipientIds: [platformAdmin.id],
    });
  });

  it("never contains the text of the question or the reply", () => {
    const { comment: question } = post(base.user.id, null, "PRIVATE-QUESTION");

    const { notifications } = post(
      base.instructor.id,
      question.id,
      "PRIVATE-REPLY"
    );

    const sent = JSON.stringify(notifications);
    expect(sent).not.toContain("PRIVATE-QUESTION");
    expect(sent).not.toContain("PRIVATE-REPLY");
  });
});
