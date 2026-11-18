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
  | { kind: "change-failed" };

const CHANGE_EVENT = "notification-change";
const changes = new EventTarget();
const pendingChanges = new Set<Promise<void>>();

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
function sendChange(body: object, change: NotificationChange): Promise<void> {
  announce(change);

  const request: Promise<void> = postChange(body)
    .catch((error: unknown) => {
      announce({ kind: "change-failed" });
      throw error;
    })
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

export function markAllRead(): Promise<void> {
  return sendChange({ intent: "mark-all-read" }, { kind: "all-read" });
}
