// ─── Notification Feed ───
// What the server and the browser share about a person's Notifications.

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

export type NotificationTypeDetails = {
  // Also the filter chip, so types sharing a label share a chip.
  label: string;
  buttonLabel: string;
};

const NOTIFICATION_TYPE_DETAILS: Record<string, NotificationTypeDetails> = {
  refund_request_approved: {
    label: "Refund",
    buttonLabel: "View refund request",
  },
  refund_request_declined: {
    label: "Refund",
    buttonLabel: "View refund request",
  },
  new_refund_request: {
    label: "Refund Request",
    buttonLabel: "Review request",
  },
  new_discussion_question: { label: "Question", buttonLabel: "Answer it" },
  new_discussion_reply: { label: "Answer", buttonLabel: "View answer" },
  seat_claimed: { label: "Seat", buttonLabel: "View team" },
  course_rated: { label: "Rating", buttonLabel: "View analytics" },
  new_enrollment: { label: "Enrollment", buttonLabel: "View students" },
};

const UNKNOWN_TYPE_DETAILS: NotificationTypeDetails = {
  label: "Other",
  buttonLabel: "Open",
};

export function getNotificationTypeDetails(
  type: string
): NotificationTypeDetails {
  return Object.hasOwn(NOTIFICATION_TYPE_DETAILS, type)
    ? NOTIFICATION_TYPE_DETAILS[type]
    : UNKNOWN_TYPE_DETAILS;
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
