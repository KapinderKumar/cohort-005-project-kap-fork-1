import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Popover } from "radix-ui";
import { ArrowRight, Bell, BellOff, CheckCheck } from "lucide-react";
import { NotificationTypeIcon } from "~/components/notification-type-icon";
import { Button } from "~/components/ui/button";
import {
  fetchNotificationFeed,
  fetchUnreadCount,
  isAllReadSettling,
  markAllRead,
  setNotificationRead,
  subscribeToNotificationChanges,
  whenNotificationChangesSettle,
} from "~/lib/notification-client";
import type { NotificationFeedItem } from "~/lib/notification-feed";
import { cn, formatRelativeTime } from "~/lib/utils";

const REFRESH_INTERVAL_MS = 60_000;

type DropdownList =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; items: NotificationFeedItem[] };

function isTabVisible() {
  return document.visibilityState === "visible";
}

function ignoreFailure() {
  // The next read of the count corrects the badge.
}

/**
 * Loads in the browser after the page renders, so no page waits for Knock.
 * Render with `key={userId}`, so a switched user never sees the last count.
 */
export function NotificationBell({ userId }: { userId: number }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<DropdownList>({ status: "loading" });

  const countRequest = useRef<AbortController | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  // Bumped by every read-state change, so older responses are discarded.
  const changeGeneration = useRef(0);

  const refreshCount = useCallback(async () => {
    if (!isTabVisible()) return;

    countRequest.current?.abort();
    const controller = new AbortController();
    countRequest.current = controller;

    try {
      await whenNotificationChangesSettle();
      if (controller.signal.aborted) return;

      const generation = changeGeneration.current;
      const count = await fetchUnreadCount(controller.signal);
      if (controller.signal.aborted) return;

      setUnavailable(false);
      if (
        generation === changeGeneration.current &&
        !isAllReadSettling(userId)
      ) {
        setUnreadCount(count);
      }
    } catch {
      if (!controller.signal.aborted) setUnavailable(true);
    }
  }, [userId]);

  const loadList = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setList({ status: "loading" });

    try {
      await whenNotificationChangesSettle();
      if (controller.signal.aborted) return;

      const generation = changeGeneration.current;
      const feed = await fetchNotificationFeed(controller.signal);
      if (controller.signal.aborted) return;

      const allReadSettling = isAllReadSettling(userId);
      setUnavailable(false);
      setList({
        status: "ready",
        items: allReadSettling
          ? feed.items.map((item) => ({ ...item, read: true }))
          : feed.items,
      });
      if (generation === changeGeneration.current && !allReadSettling) {
        setUnreadCount(feed.unreadCount);
      }
    } catch {
      if (controller.signal.aborted) return;
      setList({ status: "failed" });
      setUnavailable(true);
    }
  }, [userId]);

  // Runs on the first render and on every navigation.
  useEffect(() => {
    void refreshCount();
  }, [location.key, refreshCount]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    function startPolling() {
      timer = setInterval(() => void refreshCount(), REFRESH_INTERVAL_MS);
    }

    function handleVisibilityChange() {
      clearInterval(timer);
      if (!isTabVisible()) return;
      void refreshCount();
      startPolling();
    }

    if (isTabVisible()) startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      countRequest.current?.abort();
      listRequest.current?.abort();
    };
  }, [refreshCount]);

  useEffect(
    () =>
      subscribeToNotificationChanges((change) => {
        changeGeneration.current += 1;

        if (change.kind === "count-changed") {
          setUnreadCount((count) => Math.max(0, count + change.delta));
        } else if (change.kind === "all-read") {
          setUnreadCount(0);
          setList((current) =>
            current.status === "ready"
              ? {
                  ...current,
                  items: current.items.map((item) => ({
                    ...item,
                    read: true,
                  })),
                }
              : current
          );
        } else {
          void refreshCount();
        }
      }),
    [refreshCount]
  );

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      void loadList();
    } else {
      listRequest.current?.abort();
    }
  }

  function openNotification(item: NotificationFeedItem) {
    setOpen(false);

    if (!item.read) {
      // Not awaited: a failed mark-read must not stop the click-through.
      setNotificationRead(item.id, true).catch(ignoreFailure);
    }
    if (item.url) navigate(item.url);
  }

  const label = unavailable
    ? "Notifications are unavailable right now"
    : unreadCount > 0
      ? `Notifications, ${unreadCount} unread`
      : "Notifications";

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={
            unavailable
              ? "Notifications are unavailable right now. Click to try again."
              : "Notifications"
          }
          className={cn(
            "relative rounded-md p-1.5 hover:bg-sidebar-accent",
            unavailable
              ? "text-muted-foreground/50"
              : "text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
          )}
        >
          <Bell className="size-5" />
          {!unavailable && unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 w-96 rounded-lg border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="font-semibold">Notifications</div>
            <Button
              variant="ghost"
              size="xs"
              disabled={unavailable || unreadCount === 0}
              onClick={() => {
                markAllRead(userId).catch(ignoreFailure);
              }}
            >
              <CheckCheck /> Mark all read
            </Button>
          </div>

          <DropdownBody
            list={list}
            onRetry={() => void loadList()}
            onSelect={openNotification}
          />

          <div className="border-t p-2">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1 rounded-md py-1.5 text-sm font-medium text-primary hover:bg-accent"
            >
              View all Notifications <ArrowRight className="size-4" />
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DropdownBody({
  list,
  onRetry,
  onSelect,
}: {
  list: DropdownList;
  onRetry: () => void;
  onSelect: (item: NotificationFeedItem) => void;
}) {
  if (list.status === "loading") {
    return (
      <div className="px-6 py-10 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (list.status === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
        <BellOff className="size-8 text-muted-foreground opacity-40" />
        <div className="font-medium">Couldn&apos;t load your Notifications</div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (list.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
        <BellOff className="size-8 opacity-40" />
        <div className="font-medium text-foreground">
          You&apos;re all caught up
        </div>
        <div>
          Notifications about your courses, discussions and Refund Requests will
          show up here.
        </div>
      </div>
    );
  }

  return (
    <ul className="max-h-[28rem] divide-y overflow-y-auto">
      {list.items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item)}
            className={cn(
              "flex w-full gap-3 px-4 py-3 text-left hover:bg-accent",
              !item.read && "bg-primary/5"
            )}
          >
            <NotificationTypeIcon type={item.type} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "truncate text-sm",
                    item.read ? "text-muted-foreground" : "font-semibold"
                  )}
                >
                  {item.title}
                </span>
                {!item.read && (
                  <span className="size-2 shrink-0 rounded-full bg-primary" />
                )}
              </div>
              <div className="line-clamp-2 text-xs text-muted-foreground">
                {item.body}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground/70">
                {formatRelativeTime(item.createdAt)}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
