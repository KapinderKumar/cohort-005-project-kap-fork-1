import { useEffect, useState } from "react";
import { data, Link, useRevalidator } from "react-router";
import { ArrowRight, Bell, BellOff, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import type { Route } from "./+types/notifications";
import { NotificationTypeIcon } from "~/components/notification-type-icon";
import { Button } from "~/components/ui/button";
import {
  markAllRead,
  setNotificationRead,
  subscribeToNotificationChanges,
} from "~/lib/notification-client";
import {
  FULL_PAGE_SIZE,
  getNotificationTypeDetails,
  type NotificationFeed,
  type NotificationFeedItem,
} from "~/lib/notification-feed";
import { getNotificationFeed } from "~/lib/notifier.server";
import { getCurrentUserId } from "~/lib/session";
import { cn, formatRelativeTime } from "~/lib/utils";

export function meta() {
  return [{ title: "Notifications — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to see Notifications.", {
      status: 401,
    });
  }

  try {
    return {
      feed: await getNotificationFeed(currentUserId, FULL_PAGE_SIZE),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Could not read Notifications: ${reason}`);
    return { feed: null };
  }
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { feed } = loaderData;
  return feed ? <FeedView feed={feed} /> : <FeedUnavailable />;
}

function PageHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">Notifications</h1>
      {children}
    </div>
  );
}

function FeedUnavailable() {
  const revalidator = useRevalidator();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-8 py-5">
        <PageHeader />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <BellOff className="size-14 text-muted-foreground opacity-25" />
        <div className="text-lg font-medium">
          Couldn&apos;t load your Notifications
        </div>
        <Button
          variant="outline"
          disabled={revalidator.state === "loading"}
          onClick={() => void revalidator.revalidate()}
        >
          Retry
        </Button>
      </div>
    </div>
  );
}

function FeedView({ feed }: { feed: NotificationFeed }) {
  const [loadedFeed, setLoadedFeed] = useState(feed);
  const [items, setItems] = useState(feed.items);
  const [unreadCount, setUnreadCount] = useState(feed.unreadCount);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  // A new load (retry, or a switched user) replaces what is on screen.
  if (feed !== loadedFeed) {
    setLoadedFeed(feed);
    setItems(feed.items);
    setUnreadCount(feed.unreadCount);
    setSelectedId(null);
    setFilter(null);
  }

  // Mark all read in the bell's dropdown also applies to this page.
  useEffect(
    () =>
      subscribeToNotificationChanges((change) => {
        if (change.kind !== "all-read") return;
        setItems((current) =>
          current.map((item) => ({ ...item, read: true }))
        );
        setUnreadCount(0);
      }),
    []
  );

  function applyRead(id: string, read: boolean) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read } : item))
    );
    setUnreadCount((count) => Math.max(0, count + (read ? -1 : 1)));
  }

  function changeRead(item: NotificationFeedItem, read: boolean) {
    applyRead(item.id, read);
    setNotificationRead(item.id, read).catch(() => {
      applyRead(item.id, !read);
      toast.error("Couldn't update that Notification. Please try again.");
    });
  }

  function select(item: NotificationFeedItem) {
    setSelectedId(item.id);
    if (!item.read) changeRead(item, true);
  }

  function handleMarkAllRead() {
    const previousItems = items;
    const previousUnreadCount = unreadCount;

    markAllRead().catch(() => {
      setItems(previousItems);
      setUnreadCount(previousUnreadCount);
      toast.error("Couldn't mark your Notifications read. Please try again.");
    });
  }

  const labels = [
    ...new Set(items.map((item) => getNotificationTypeDetails(item.type).label)),
  ];
  const activeFilter = filter && labels.includes(filter) ? filter : null;
  const visibleItems = activeFilter
    ? items.filter(
        (item) => getNotificationTypeDetails(item.type).label === activeFilter
      )
    : items;
  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-8 py-5">
        <PageHeader>
          <p className="text-sm text-muted-foreground">
            {unreadCount} unread of {feed.totalCount}
          </p>
        </PageHeader>
        <Button
          variant="outline"
          disabled={unreadCount === 0}
          onClick={handleMarkAllRead}
        >
          <CheckCheck /> Mark all read
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <Bell className="size-14 opacity-25" />
          <div className="text-lg font-medium text-foreground">
            Nothing here yet
          </div>
          <div className="max-w-sm text-sm">
            When something happens that concerns you, such as an answer to your
            question or a decision on your refund request, it will show up here.
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 border-b px-8 py-3">
            <FilterChip
              active={activeFilter === null}
              onClick={() => setFilter(null)}
            >
              All
            </FilterChip>
            {labels.map((label) => (
              <FilterChip
                key={label}
                active={activeFilter === label}
                onClick={() => setFilter(label)}
              >
                {label}
              </FilterChip>
            ))}
          </div>

          <div className="flex min-h-0 flex-1">
            <ul className="w-[26rem] shrink-0 overflow-y-auto border-r">
              {visibleItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => select(item)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b px-6 py-3 text-left",
                      selectedId === item.id
                        ? "bg-accent"
                        : "hover:bg-accent/50",
                      selectedId !== item.id && !item.read && "bg-primary/5"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-2 size-2 shrink-0 rounded-full",
                        item.read ? "bg-transparent" : "bg-primary"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            !item.read && "font-semibold"
                          )}
                        >
                          {item.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {item.body}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex-1 overflow-y-auto p-10">
              {selected ? (
                <NotificationDetail
                  item={selected}
                  onToggleRead={() => changeRead(selected, !selected.read)}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select a Notification
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NotificationDetail({
  item,
  onToggleRead,
}: {
  item: NotificationFeedItem;
  onToggleRead: () => void;
}) {
  const { label, buttonLabel } = getNotificationTypeDetails(item.type);

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <NotificationTypeIcon type={item.type} className="size-10" />
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label} · {formatRelativeTime(item.createdAt)}
          </div>
          <h2 className="text-xl font-semibold">{item.title}</h2>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-base">{item.body}</p>
      <div className="flex gap-2">
        {item.url && (
          <Button asChild>
            <Link to={item.url}>
              {buttonLabel} <ArrowRight />
            </Link>
          </Button>
        )}
        <Button variant="ghost" onClick={onToggleRead}>
          Mark {item.read ? "unread" : "read"}
        </Button>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
