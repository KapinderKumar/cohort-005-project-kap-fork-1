import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Knock from "@knocklabs/node";
import { z } from "zod";

// ─── In-app Notifications ───
// The only code that touches Knock (docs/adr/0013). Knock delivers and stores
// Notifications when KNOCK_API_KEY is set. Without a key (local dev, tests)
// each one is written to .outbox/ instead, and the Notification Feed is empty.

export type NotificationType =
  | "refund_request_approved"
  | "refund_request_declined"
  | "new_refund_request"
  | "new_discussion_question"
  | "new_discussion_reply"
  | "seat_claimed"
  | "course_rated"
  | "new_enrollment";

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
}

const KNOCK_TIMEOUT_MS = 3000;

// The SDK's page object hides `meta`, so the count is read from the raw response.
const feedResponseSchema = z.object({
  meta: z.object({ unread_count: z.number() }),
});

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

      return feedResponseSchema.parse(await response.json()).meta.unread_count;
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
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Could not send Notification (${type}): ${reason}`);
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
