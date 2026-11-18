import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { z } from "zod";

const unreadCountSchema = z.object({ unreadCount: z.number() });

async function fetchUnreadCount(signal: AbortSignal): Promise<number> {
  const response = await fetch("/api/notifications", { signal });
  if (!response.ok) {
    throw new Error(`Notifications returned ${response.status}`);
  }
  return unreadCountSchema.parse(await response.json()).unreadCount;
}

/**
 * Loads in the browser after the page renders, so no page waits for Knock.
 * Render with `key={userId}`, so a switched user never sees the last count.
 */
export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetchUnreadCount(controller.signal)
      .then(setUnreadCount)
      .catch(() => {
        // The bell stays quiet when the count can't be read.
      });

    return () => controller.abort();
  }, []);

  return (
    <span
      role="img"
      aria-label={
        unreadCount > 0
          ? `Notifications, ${unreadCount} unread`
          : "Notifications"
      }
      className="relative inline-flex rounded-md p-1 text-sidebar-foreground/70"
    >
      <Bell className="size-4" />
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </span>
  );
}
