import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

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

describe("createComment", () => {
  it("posts a top-level comment with its body trimmed", () => {
    const comment = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "  How does this work?  "
    );

    expect(comment).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "How does this work?",
    });
    expect(storedComments()).toHaveLength(1);
  });

  it("posts a reply to a top-level comment", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");

    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    expect(reply.parentId).toBe(question.id);
    expect(storedComments()).toHaveLength(2);
  });

  it("accepts a body of exactly 5000 characters", () => {
    const comment = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "a".repeat(5000)
    );

    expect(comment.body).toHaveLength(5000);
  });

  it("rejects a body that is only whitespace", () => {
    expect(() =>
      createComment(db, base.user.id, lessonId, null, "   \n ")
    ).toThrow("Comment cannot be empty");
    expect(storedComments()).toHaveLength(0);
  });

  it("rejects a body over 5000 characters", () => {
    expect(() =>
      createComment(db, base.user.id, lessonId, null, "a".repeat(5001))
    ).toThrow("Comment must be 5000 characters or fewer");
    expect(storedComments()).toHaveLength(0);
  });

  it("rejects a lesson that does not exist", () => {
    expect(() =>
      createComment(db, base.user.id, 9999, null, "Hello")
    ).toThrow("Lesson not found");
    expect(storedComments()).toHaveLength(0);
  });

  it("rejects a parent comment that does not exist", () => {
    expect(() =>
      createComment(db, base.user.id, lessonId, 9999, "Hello")
    ).toThrow("Parent comment not found");
    expect(storedComments()).toHaveLength(0);
  });

  it("rejects a parent comment on a different lesson", () => {
    const question = createComment(
      db,
      base.user.id,
      otherLessonId,
      null,
      "Why?"
    );

    expect(() =>
      createComment(db, base.instructor.id, lessonId, question.id, "Because.")
    ).toThrow("Parent comment belongs to a different lesson");
    expect(storedComments()).toHaveLength(1);
  });

  it("rejects a reply to a reply", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    expect(() =>
      createComment(db, base.user.id, lessonId, reply.id, "But why?")
    ).toThrow("Replies can only be one level deep");
    expect(storedComments()).toHaveLength(2);
  });
});
