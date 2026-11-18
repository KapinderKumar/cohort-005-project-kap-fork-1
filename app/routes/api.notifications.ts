import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notifications";
import { DROPDOWN_PAGE_SIZE } from "~/lib/notification-feed";
import {
  getNotificationFeed,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  NotificationNotFoundError,
} from "~/lib/notifier.server";
import { getCurrentUserId } from "~/lib/session";
import { parseJsonBody } from "~/lib/validation";

const viewSchema = z.object({
  view: z.enum(["count", "feed"]).default("count"),
});

const notificationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const changeSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("mark-read"), id: notificationIdSchema }),
  z.object({ intent: z.literal("mark-unread"), id: notificationIdSchema }),
  z.object({ intent: z.literal("mark-all-read") }),
]);

async function requireUserId(request: Request): Promise<number> {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to see Notifications.", {
      status: 401,
    });
  }

  return currentUserId;
}

function unavailable(error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Could not reach Notifications: ${reason}`);
  return data("Notifications are unavailable.", { status: 503 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await requireUserId(request);
  const parsed = viewSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );

  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  try {
    if (parsed.data.view === "feed") {
      return Response.json(
        await getNotificationFeed(currentUserId, DROPDOWN_PAGE_SIZE)
      );
    }

    const unreadCount = await getUnreadCount(currentUserId);
    return Response.json({ unreadCount });
  } catch (error) {
    throw unavailable(error);
  }
}

async function parseChange(request: Request) {
  try {
    return await parseJsonBody(request, changeSchema);
  } catch {
    throw data("Invalid parameters", { status: 400 });
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw data("Method not allowed", { status: 405 });
  }

  const currentUserId = await requireUserId(request);
  const parsed = await parseChange(request);

  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const change = parsed.data;

  try {
    if (change.intent === "mark-read") {
      await markNotificationRead(currentUserId, change.id);
    } else if (change.intent === "mark-unread") {
      await markNotificationUnread(currentUserId, change.id);
    } else {
      await markAllNotificationsRead(currentUserId);
    }
  } catch (error) {
    if (error instanceof NotificationNotFoundError) {
      throw data("Notification not found.", { status: 404 });
    }
    throw unavailable(error);
  }

  return Response.json({ success: true });
}
