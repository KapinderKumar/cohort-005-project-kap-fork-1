// ─── Notification Feed ───
// What the server and the browser share about a person's Notifications.

export type NotificationType =
  | "refund_request_approved"
  | "refund_request_declined"
  | "new_refund_request"
  | "new_discussion_question"
  | "new_discussion_reply"
  | "seat_claimed"
  | "course_rated"
  | "new_enrollment";

export type NotificationFeedItem = {
  id: string;
  // A plain string: feed items outlive the code that sent them.
  type: string;
  title: string;
  body: string;
  // Null when the stored link isn't a path inside Cadence.
  url: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationFeed = {
  items: NotificationFeedItem[];
  unreadCount: number;
  totalCount: number;
};

export const EMPTY_NOTIFICATION_FEED: NotificationFeed = {
  items: [],
  unreadCount: 0,
  totalCount: 0,
};

export const DROPDOWN_PAGE_SIZE = 10;
export const FULL_PAGE_SIZE = 50;

export const NOTIFICATIONS_SIGNED_OUT_MESSAGE =
  "Select a user from the DevUI panel to see Notifications.";

export type NotificationTypeDetails = {
  // Also the filter chip, so types sharing a label share a chip.
  label: string;
  buttonLabel: string;
};

const NOTIFICATION_TYPE_DETAILS: Record<
  NotificationType,
  NotificationTypeDetails
> = {
  refund_request_approved: {
    label: "Refund Request",
    buttonLabel: "View refund request",
  },
  refund_request_declined: {
    label: "Refund Request",
    buttonLabel: "View refund request",
  },
  new_refund_request: {
    label: "Refund Request",
    buttonLabel: "Review request",
  },
  new_discussion_question: {
    label: "Discussion Question",
    buttonLabel: "Answer it",
  },
  new_discussion_reply: {
    label: "Discussion Reply",
    buttonLabel: "View answer",
  },
  seat_claimed: { label: "Seat", buttonLabel: "View team" },
  course_rated: { label: "Rating", buttonLabel: "View analytics" },
  new_enrollment: { label: "Enrollment", buttonLabel: "View students" },
};

const UNKNOWN_TYPE_DETAILS: NotificationTypeDetails = {
  label: "Other",
  buttonLabel: "Open",
};

/** Feed items outlive the code that sent them, so a stored type may be retired. */
export function isNotificationType(type: string): type is NotificationType {
  return Object.hasOwn(NOTIFICATION_TYPE_DETAILS, type);
}

export function getNotificationTypeDetails(
  type: string
): NotificationTypeDetails {
  return isNotificationType(type)
    ? NOTIFICATION_TYPE_DETAILS[type]
    : UNKNOWN_TYPE_DETAILS;
}

// ─── Read state on the full page ───
// What the page shows while its changes are on their way to Knock.

type FeedReadCounts = Pick<NotificationFeed, "items" | "unreadCount">;

export type FeedReadState = FeedReadCounts & {
  // What to go back to if the latest Mark all read fails.
  beforeAllRead: FeedReadCounts | null;
};

export function markAllReadInState(state: FeedReadState): FeedReadState {
  return {
    items: state.items.map((item) => ({ ...item, read: true })),
    unreadCount: 0,
    beforeAllRead: { items: state.items, unreadCount: state.unreadCount },
  };
}

/**
 * Knock can still return the old state just after Mark all read, so a feed
 * loaded while it settles is shown as read. It stays restorable in case Mark
 * all read fails.
 */
export function readStateFromFeed(
  feed: NotificationFeed,
  allReadSettling: boolean
): FeedReadState {
  const state: FeedReadState = {
    items: feed.items,
    unreadCount: feed.unreadCount,
    beforeAllRead: null,
  };
  return allReadSettling ? markAllReadInState(state) : state;
}

export function undoAllReadInState(state: FeedReadState): FeedReadState {
  return state.beforeAllRead
    ? { ...state.beforeAllRead, beforeAllRead: null }
    : state;
}

function setItemRead<T extends FeedReadCounts>(
  counts: T,
  id: string,
  read: boolean
): T {
  const target = counts.items.find((item) => item.id === id);
  if (!target || target.read === read) return counts;

  return {
    ...counts,
    items: counts.items.map((item) =>
      item.id === id ? { ...item, read } : item
    ),
    unreadCount: Math.max(0, counts.unreadCount + (read ? -1 : 1)),
  };
}

/** Also applies to the rollback, so undoing Mark all read keeps this change. */
export function setItemReadInState(
  state: FeedReadState,
  id: string,
  read: boolean
): FeedReadState {
  return {
    ...setItemRead(state, id, read),
    beforeAllRead:
      state.beforeAllRead && setItemRead(state.beforeAllRead, id, read),
  };
}

const LINK_BASE = "https://cadence.invalid";

/**
 * The link if it is a relative path inside Cadence, otherwise null. Parsing
 * catches what a browser would resolve elsewhere, such as `/\example.com`.
 */
export function toInternalNotificationUrl(url: string): string | null {
  if (!url.startsWith("/")) return null;

  try {
    const parsed = new URL(url, LINK_BASE);
    if (parsed.origin !== LINK_BASE) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
