import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { findRating, rateCourse } from "./ratings.server";

type TestDb = ReturnType<typeof createTestDb>;

const LONG_AGO = "2020-01-01T00:00:00.000Z";

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

function storedRatings() {
  return db.select().from(schema.courseRatings).all();
}

function ageRatings() {
  db.update(schema.courseRatings)
    .set({ createdAt: LONG_AGO, updatedAt: LONG_AGO })
    .where(eq(schema.courseRatings.courseId, base.course.id))
    .run();
}

describe("rateCourse", () => {
  it("records a first rating", () => {
    const { rating } = rateCourse(db, base.user.id, base.course.id, 4);

    expect(rating).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      rating: 4,
    });
    expect(findRating(db, base.user.id, base.course.id)?.rating).toBe(4);
  });

  it("replaces the person's rating when it changes", () => {
    rateCourse(db, base.user.id, base.course.id, 3);
    ageRatings();

    const { rating } = rateCourse(db, base.user.id, base.course.id, 5);

    expect(rating.rating).toBe(5);
    expect(rating.createdAt).toBe(LONG_AGO);
    expect(rating.updatedAt).not.toBe(LONG_AGO);
    expect(storedRatings()).toHaveLength(1);
  });

  it("keeps one rating and refreshes its time when the value is unchanged", () => {
    rateCourse(db, base.user.id, base.course.id, 3);
    ageRatings();

    const { rating } = rateCourse(db, base.user.id, base.course.id, 3);

    expect(rating.rating).toBe(3);
    expect(rating.updatedAt).not.toBe(LONG_AGO);
    expect(storedRatings()).toHaveLength(1);
  });

  it("keeps each person's rating separate", () => {
    rateCourse(db, base.user.id, base.course.id, 2);
    rateCourse(db, base.instructor.id, base.course.id, 5);

    expect(findRating(db, base.user.id, base.course.id)?.rating).toBe(2);
    expect(findRating(db, base.instructor.id, base.course.id)?.rating).toBe(5);
  });

  it.each([0, 6, 2.5])("rejects a rating of %s", (value) => {
    expect(() => rateCourse(db, base.user.id, base.course.id, value)).toThrow(
      "Rating must be a whole number between 1 and 5"
    );
    expect(storedRatings()).toHaveLength(0);
  });

  it("rejects a course that does not exist", () => {
    expect(() => rateCourse(db, base.user.id, 9999, 4)).toThrow(
      "Course not found"
    );
    expect(storedRatings()).toHaveLength(0);
  });

  it("fails at the write for a rater who doesn't exist, as it always has", () => {
    expect(() => rateCourse(db, 9999, base.course.id, 4)).toThrow(
      "FOREIGN KEY constraint failed"
    );
    expect(storedRatings()).toHaveLength(0);
  });
});

describe("the Course rated Notification", () => {
  it("tells the Instructor about a first rating", () => {
    const { notifications } = rateCourse(db, base.user.id, base.course.id, 4);

    expect(notifications).toEqual([
      {
        type: "course_rated",
        actorId: base.user.id,
        recipientIds: [base.instructor.id],
        title: "Course rated",
        body: "Test User rated Test Course 4 out of 5.",
        url: "/instructor/analytics",
      },
    ]);
  });

  it("tells the Instructor the old and new values of a changed rating", () => {
    rateCourse(db, base.user.id, base.course.id, 3);

    const { notifications } = rateCourse(db, base.user.id, base.course.id, 4);

    expect(notifications).toEqual([
      {
        type: "course_rated",
        actorId: base.user.id,
        recipientIds: [base.instructor.id],
        title: "Course rated",
        body: "Test User changed their rating of Test Course from 3 to 4 out of 5.",
        url: "/instructor/analytics",
      },
    ]);
  });

  it("is not sent when the rating is unchanged", () => {
    rateCourse(db, base.user.id, base.course.id, 3);
    ageRatings();

    const { notifications } = rateCourse(db, base.user.id, base.course.id, 3);

    expect(notifications).toEqual([]);
  });
});
