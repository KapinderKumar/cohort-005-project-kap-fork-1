import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Knock from "@knocklabs/node";
import { z } from "zod";
import {
  EMPTY_NOTIFICATION_FEED,
  toInternalNotificationUrl,
  type NotificationFeed,
  type NotificationFeedItem,
  type NotificationType,
} from "~/lib/notification-feed";
import { getErrorMessage } from "~/lib/utils";

// ─── In-app Notifications ───
// The only code that touches Knock (docs/adr/0013). Knock delivers and stores
// Notifications when KNOCK_API_KEY is set. Without a key (local dev, tests)
// each one is written to .outbox/ instead, and the Notification Feed is empty.

export type Notification = {
  type: NotificationType;
  actorId: number;
  recipientIds: number[];
  title: string;
  body: string;
  url: string; // relative path
};

export type OutgoingNotification = {
  type: NotificationType;
  // Always objects: a bare id string fails silently for a new Knock user.
  recipients: { id: string }[];
  title: string;
  body: string;
  url: string;
};

export interface NotificationTransport {
  send(notification: OutgoingNotification, signal: AbortSignal): Promise<void>;
  getUnreadCount(userId: number, signal: AbortSignal): Promise<number>;
  listFeed(
    userId: number,
    pageSize: number,
    signal: AbortSignal
  ): Promise<NotificationFeed>;
  ownsNotification(
    userId: number,
    notificationId: string,
    signal: AbortSignal
  ): Promise<boolean>;
  markRead(notificationId: string, signal: AbortSignal): Promise<void>;
  markUnread(notificationId: string, signal: AbortSignal): Promise<void>;
  markAllRead(userId: number, signal: AbortSignal): Promise<void>;
}

/** The Notification doesn't exist, or belongs to someone else. */
export class NotificationNotFoundError extends Error {
  constructor(notificationId: string) {
    super(`Notification ${notificationId} was not found`);
    this.name = "NotificationNotFoundError";
  }
}

const KNOCK_TIMEOUT_MS = 3000;

// The SDK's page object hides `meta`, so both schemas read the raw response.
// Reading the count needs only `meta`; listing also needs the entries and total.
const unreadCountResponseSchema = z.object({
  meta: z.object({ unread_count: z.number() }),
});

const feedListResponseSchema = z.object({
  entries: z.array(z.unknown()),
  meta: z.object({ unread_count: z.number(), total_count: z.number() }),
});

const feedEntrySchema = z.object({
  id: z.string(),
  inserted_at: z.string(),
  read_at: z.string().nullish(),
  data: z.object({
    type: z.string(),
    title: z.string(),
    body: z.string(),
    url: z.string(),
  }),
});

// An array for flatMap: an entry that doesn't parse yields no items.
function feedItemsFromEntry(entry: unknown): NotificationFeedItem[] {
  const parsed = feedEntrySchema.safeParse(entry);
  if (!parsed.success) return [];

  const { id, inserted_at, read_at, data } = parsed.data;
  return [
    {
      id,
      type: data.type,
      title: data.title,
      body: data.body,
      url: toInternalNotificationUrl(data.url),
      read: Boolean(read_at),
      createdAt: inserted_at,
    },
  ];
}

export function knockTransport(
  apiKey: string,
  workflowKey: string,
  feedChannelId: string,
  fetchImpl: typeof fetch = fetch
): NotificationTransport {
  const knock = new Knock({ apiKey, maxRetries: 0, fetch: fetchImpl });

  return {
    async send({ recipients, ...data }, signal) {
      await knock.workflows.trigger(
        workflowKey,
        { recipients, data },
        { signal }
      );
    },

    async getUnreadCount(userId, signal) {
      const response = await knock.users.feeds
        .listItems(String(userId), feedChannelId, { page_size: 1 }, { signal })
        .asResponse();

      return unreadCountResponseSchema.parse(await response.json()).meta
        .unread_count;
    },

    async listFeed(userId, pageSize, signal) {
      const response = await knock.users.feeds
        .listItems(
          String(userId),
          feedChannelId,
          { page_size: pageSize },
          { signal }
        )
        .asResponse();
      const { entries, meta } = feedListResponseSchema.parse(
        await response.json()
      );

      return {
        items: entries.flatMap(feedItemsFromEntry),
        unreadCount: meta.unread_count,
        totalCount: meta.total_count,
      };
    },

    async ownsNotification(userId, notificationId, signal) {
      try {
        const message = await knock.messages.get(notificationId, { signal });
        return (
          message.recipient === String(userId) &&
          message.channel_id === feedChannelId
        );
      } catch (error) {
        if (error instanceof Knock.NotFoundError) return false;
        throw error;
      }
    },

    async markRead(notificationId, signal) {
      await knock.messages.markAsRead(notificationId, { signal });
    },

    async markUnread(notificationId, signal) {
      await knock.messages.markAsUnread(notificationId, { signal });
    },

    async markAllRead(userId, signal) {
      // Always filtered: an unfiltered bulk update can reach every recipient.
      await knock.channels.bulk.updateMessageStatus(
        feedChannelId,
        "read",
        { recipient_ids: [String(userId)] },
        { signal }
      );
    },
  };
}

export function outboxNotificationTransport(
  directory: string
): NotificationTransport {
  return {
    async send(notification) {
      mkdirSync(directory, { recursive: true });
      const file = join(
        directory,
        `${Date.now()}-notification-${randomUUID()}.json`
      );
      writeFileSync(file, JSON.stringify(notification, null, 2));
    },

    async getUnreadCount() {
      return 0;
    },

    async listFeed() {
      return EMPTY_NOTIFICATION_FEED;
    },

    // The local feed is always empty, so read-state changes have nothing to do.
    async ownsNotification() {
      return true;
    },
    async markRead() {},
    async markUnread() {},
    async markAllRead() {},
  };
}

function requireKnockSetting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required with KNOCK_API_KEY`);
  return value;
}

function defaultTransport(): NotificationTransport {
  const apiKey = process.env.KNOCK_API_KEY;
  if (!apiKey) return outboxNotificationTransport(".outbox");

  return knockTransport(
    apiKey,
    requireKnockSetting("KNOCK_WORKFLOW_KEY"),
    requireKnockSetting("KNOCK_FEED_CHANNEL_ID")
  );
}

async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Knock did not respond within ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function logSendFailure(type: NotificationType | "all", error: unknown) {
  console.error(
    `Could not send Notification (${type}): ${getErrorMessage(error)}`
  );
}

/**
 * Sends Notifications after the database commit and before any email. Never
 * throws: a Notification that can't be sent is logged and lost, so it can't
 * fail the action that caused it. This is the only place "never notify on your
 * own action" is enforced.
 */
export async function sendNotifications(
  notifications: Notification[],
  transport?: NotificationTransport,
  timeoutMs: number = KNOCK_TIMEOUT_MS
): Promise<void> {
  const outgoing = notifications.flatMap(
    ({ actorId, recipientIds, ...content }): OutgoingNotification[] => {
      const recipients = recipientIds
        .filter((id) => id !== actorId)
        .map((id) => ({ id: String(id) }));
      return recipients.length > 0 ? [{ ...content, recipients }] : [];
    }
  );

  if (outgoing.length === 0) return;

  let activeTransport: NotificationTransport;
  try {
    activeTransport = transport ?? defaultTransport();
  } catch (error) {
    logSendFailure("all", error);
    return;
  }

  await Promise.all(
    outgoing.map(async (notification) => {
      try {
        await withTimeout(
          (signal) => activeTransport.send(notification, signal),
          timeoutMs
        );
      } catch (error) {
        logSendFailure(notification.type, error);
      }
    })
  );
}

/** A person's unread count. Failures and timeouts reach the caller. */
export async function getUnreadCount(
  userId: number,
  transport: NotificationTransport = defaultTransport(),
  timeoutMs: number = KNOCK_TIMEOUT_MS
): Promise<number> {
  return withTimeout(
    (signal) => transport.getUnreadCount(userId, signal),
    timeoutMs
  );
}

/** A person's newest Notifications. Failures and timeouts reach the caller. */
export async function getNotificationFeed(
  userId: number,
  pageSize: number,
  transport: NotificationTransport = defaultTransport(),
  timeoutMs: number = KNOCK_TIMEOUT_MS
): Promise<NotificationFeed> {
  return withTimeout(
    (signal) => transport.listFeed(userId, pageSize, signal),
    timeoutMs
  );
}

async function changeOwnNotification(
  userId: number,
  notificationId: string,
  change: "markRead" | "markUnread",
  transport: NotificationTransport,
  timeoutMs: number
): Promise<void> {
  await withTimeout(async (signal) => {
    const owned = await transport.ownsNotification(
      userId,
      notificationId,
      signal
    );
    if (!owned) throw new NotificationNotFoundError(notificationId);
    await transport[change](notificationId, signal);
  }, timeoutMs);
}

/** Throws NotificationNotFoundError unless the Notification is the person's. */
export async function markNotificationRead(
  userId: number,
  notificationId: string,
  transport: NotificationTransport = defaultTransport(),
  timeoutMs: number = KNOCK_TIMEOUT_MS
): Promise<void> {
  await changeOwnNotification(
    userId,
    notificationId,
    "markRead",
    transport,
    timeoutMs
  );
}

/** Throws NotificationNotFoundError unless the Notification is the person's. */
export async function markNotificationUnread(
  userId: number,
  notificationId: string,
  transport: NotificationTransport = defaultTransport(),
  timeoutMs: number = KNOCK_TIMEOUT_MS
): Promise<void> {
  await changeOwnNotification(
    userId,
    notificationId,
    "markUnread",
    transport,
    timeoutMs
  );
}

/** Knock finishes this shortly after it returns, so a re-read can lag. */
export async function markAllNotificationsRead(
  userId: number,
  transport: NotificationTransport = defaultTransport(),
  timeoutMs: number = KNOCK_TIMEOUT_MS
): Promise<void> {
  await withTimeout(
    (signal) => transport.markAllRead(userId, signal),
    timeoutMs
  );
}
