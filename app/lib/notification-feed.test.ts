import { describe, expect, it } from "vitest";
import {
  getNotificationTypeDetails,
  isNotificationType,
  markAllReadInState,
  readStateFromFeed,
  setItemReadInState,
  undoAllReadInState,
  type NotificationFeed,
  type NotificationFeedItem,
} from "./notification-feed";

function item(id: string, read: boolean): NotificationFeedItem {
  return {
    id,
    type: "new_enrollment",
    title: "New enrollment",
    body: "Sam enrolled in Algebra.",
    url: null,
    read,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

// Two unread on this page, and more unread on older pages.
const FEED: NotificationFeed = {
  items: [item("a", false), item("b", false), item("c", true)],
  unreadCount: 12,
  totalCount: 60,
};

function readFlags(state: { items: NotificationFeedItem[] }) {
  return Object.fromEntries(state.items.map(({ id, read }) => [id, read]));
}

describe("the Notification Feed page's read state", () => {
  it("shows a loaded feed as it is", () => {
    const state = readStateFromFeed(FEED, false);

    expect(readFlags(state)).toEqual({ a: false, b: false, c: true });
    expect(state.unreadCount).toBe(12);
  });

  it("doesn't let a feed loaded while Mark all read settles undo it", () => {
    const state = readStateFromFeed(FEED, true);

    expect(readFlags(state)).toEqual({ a: true, b: true, c: true });
    expect(state.unreadCount).toBe(0);
  });

  it("restores a feed loaded while settling if Mark all read then fails", () => {
    const state = undoAllReadInState(readStateFromFeed(FEED, true));

    expect(readFlags(state)).toEqual({ a: false, b: false, c: true });
    expect(state.unreadCount).toBe(12);
  });

  it("marks everything read and clears the count", () => {
    const state = markAllReadInState(readStateFromFeed(FEED, false));

    expect(readFlags(state)).toEqual({ a: true, b: true, c: true });
    expect(state.unreadCount).toBe(0);
  });

  it("rolls a failed Mark all read back", () => {
    const state = undoAllReadInState(
      markAllReadInState(readStateFromFeed(FEED, false))
    );

    expect(readFlags(state)).toEqual({ a: false, b: false, c: true });
    expect(state.unreadCount).toBe(12);
  });

  it("keeps a change made while Mark all read was in progress when rolling back", () => {
    const allRead = markAllReadInState(readStateFromFeed(FEED, false));
    const state = undoAllReadInState(setItemReadInState(allRead, "c", false));

    expect(readFlags(state)).toEqual({ a: false, b: false, c: false });
    expect(state.unreadCount).toBe(13);
  });

  it("ignores a failure when no Mark all read is waiting to be undone", () => {
    const state = readStateFromFeed(FEED, false);

    expect(undoAllReadInState(state)).toEqual(state);
  });

  it("counts a single change once, however often it is applied", () => {
    const once = setItemReadInState(readStateFromFeed(FEED, false), "a", true);
    const twice = setItemReadInState(once, "a", true);

    expect(readFlags(twice)).toEqual({ a: true, b: false, c: true });
    expect(twice.unreadCount).toBe(11);
  });
});

describe("Notification type details", () => {
  it("doesn't call a declined Refund Request a Refund", () => {
    expect(getNotificationTypeDetails("refund_request_declined").label).toBe(
      "Refund Request"
    );
  });

  it("files every Refund Request Notification under one chip", () => {
    expect(getNotificationTypeDetails("refund_request_approved").label).toBe(
      "Refund Request"
    );
    expect(getNotificationTypeDetails("new_refund_request").label).toBe(
      "Refund Request"
    );
  });

  it("uses the glossary's discussion terms for chips", () => {
    expect(getNotificationTypeDetails("new_discussion_question").label).toBe(
      "Discussion Question"
    );
    expect(getNotificationTypeDetails("new_discussion_reply").label).toBe(
      "Discussion Reply"
    );
  });

  it("keeps the button labels the spec sets", () => {
    expect(
      getNotificationTypeDetails("new_discussion_question").buttonLabel
    ).toBe("Answer it");
    expect(getNotificationTypeDetails("new_discussion_reply").buttonLabel).toBe(
      "View answer"
    );
  });

  it.each(["retired_type", "constructor"])(
    "falls back for %s, which is not a current type",
    (type) => {
      expect(isNotificationType(type)).toBe(false);
      expect(getNotificationTypeDetails(type)).toEqual({
        label: "Other",
        buttonLabel: "Open",
      });
    }
  );
});
