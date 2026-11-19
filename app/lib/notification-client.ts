import { z } from "zod";
import type { NotificationFeed } from "~/lib/notification-feed";

// ─── Notification Feed requests from the browser ───
// Read-state changes go through here so the bell and the full page stay in step.

const ENDPOINT = "/api/notifications";

const unreadCountSchema = z.object({ unreadCount: z.number() });

const feedSchema: z.ZodType<NotificationFeed> = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      body: z.string(),
      url: z.string().nullable(),
      read: z.boolean(),
      createdAt: z.string(),
    })
  ),
  unreadCount: z.number(),
  totalCount: z.number(),
});

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Notifications returned ${response.status}`);
  }
  return response.json();
}

export async function fetchUnreadCount(signal: AbortSignal): Promise<number> {
  return unreadCountSchema.parse(await readJson(ENDPOINT, signal)).unreadCount;
}

export async function fetchNotificationFeed(
  signal: AbortSignal
): Promise<NotificationFeed> {
  return feedSchema.parse(await readJson(`${ENDPOINT}?view=feed`, signal));
}

export type NotificationChange =
  | { kind: "count-changed"; delta: number }
  | { kind: "all-read" }
  | { kind: "change-failed"; failed: "count-changed" | "all-read" };

type RequestedChange = Exclude<NotificationChange, { kind: "change-failed" }>;

const CHANGE_EVENT = "notification-change";
const changes = new EventTarget();
const pendingChanges = new Set<Promise<void>>();

// Knock finishes Mark all read shortly after accepting it, so a read this soon
// afterwards can still return the old state.
const ALL_READ_SETTLE_MS = 3000;

// Kept per person: the DevUI switches users without reloading the page.
const allReadByUser = new Map<
  number,
  { inFlight: number; settlesAt: number }
>();

/** True from Mark all read starting until Knock has had time to finish it. */
export function isAllReadSettling(userId: number): boolean {
  const allRead = allReadByUser.get(userId);
  if (!allRead) return false;
  return allRead.inFlight > 0 || Date.now() < allRead.settlesAt;
}

function announce(change: NotificationChange) {
  changes.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: change }));
}

export function subscribeToNotificationChanges(
  listener: (change: NotificationChange) => void
): () => void {
  const handler = (event: Event) =>
    listener((event as CustomEvent<NotificationChange>).detail);
  changes.addEventListener(CHANGE_EVENT, handler);
  return () => changes.removeEventListener(CHANGE_EVENT, handler);
}

/** Lets a read wait, so it doesn't return the state from before a change. */
export async function whenNotificationChangesSettle(): Promise<void> {
  await Promise.allSettled(pendingChanges);
}

async function postChange(body: object): Promise<void> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Notifications returned ${response.status}`);
  }
}

// Announces the change straight away, so the UI doesn't wait for Knock.
function sendChange(
  body: object,
  change: RequestedChange,
  onSettled?: (succeeded: boolean) => void
): Promise<void> {
  announce(change);

  const request: Promise<void> = postChange(body)
    .then(
      () => onSettled?.(true),
      (error: unknown) => {
        onSettled?.(false);
        announce({ kind: "change-failed", failed: change.kind });
        throw error;
      }
    )
    .finally(() => pendingChanges.delete(request));

  pendingChanges.add(request);
  return request;
}

export function setNotificationRead(id: string, read: boolean): Promise<void> {
  return sendChange(
    { intent: read ? "mark-read" : "mark-unread", id },
    { kind: "count-changed", delta: read ? -1 : 1 }
  );
}

export function markAllRead(userId: number): Promise<void> {
  const allRead = allReadByUser.get(userId) ?? { inFlight: 0, settlesAt: 0 };
  allReadByUser.set(userId, allRead);
  allRead.inFlight += 1;

  return sendChange(
    { intent: "mark-all-read" },
    { kind: "all-read" },
    (succeeded) => {
      allRead.inFlight -= 1;
      allRead.settlesAt = succeeded ? Date.now() + ALL_READ_SETTLE_MS : 0;
    }
  );
}
