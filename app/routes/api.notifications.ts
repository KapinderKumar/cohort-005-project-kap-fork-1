import { data } from "react-router";
import type { Route } from "./+types/api.notifications";
import { getUnreadCount } from "~/lib/notifier.server";
import { getCurrentUserId } from "~/lib/session";

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to see Notifications.", {
      status: 401,
    });
  }

  try {
    const unreadCount = await getUnreadCount(currentUserId);
    return Response.json({ unreadCount });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Could not read Notifications: ${reason}`);
    throw data("Notifications are unavailable.", { status: 503 });
  }
}
