import { useEffect, useState } from "react";
import { data, isRouteErrorResponse, Link, useRevalidator } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BellOff,
  CheckCheck,
} from "lucide-react";
import type { Route } from "./+types/notifications";
import { NotificationTypeIcon } from "~/components/notification-type-icon";
import { Button } from "~/components/ui/button";
import { requireUserId } from "~/lib/access.server";
import {
  isAllReadSettling,
  markAllRead,
  setNotificationRead,
  subscribeToNotificationChanges,
} from "~/lib/notification-client";
import {
  FULL_PAGE_SIZE,
  getNotificationTypeDetails,
  markAllReadInState,
  NOTIFICATIONS_SIGNED_OUT_MESSAGE,
  readStateFromFeed,
  setItemReadInState,
  undoAllReadInState,
  type NotificationFeed,
  type NotificationFeedItem,
} from "~/lib/notification-feed";
import { getNotificationFeed } from "~/lib/notifier.server";
import { cn, formatRelativeTime, getErrorMessage } from "~/lib/utils";

const FEED_UNAVAILABLE_MESSAGE = "Couldn't load your Notifications";
const CHANGE_FAILED_MESSAGE =
  "Couldn't update that Notification. Please try again.";
const ALL_READ_FAILED_MESSAGE =
  "Couldn't mark your Notifications read. Please try again.";

export function meta() {
  return [{ title: "Notifications — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request, NOTIFICATIONS_SIGNED_OUT_MESSAGE);

  try {
    return {
      feed: await getNotificationFeed(userId, FULL_PAGE_SIZE),
      userId,
    };
  } catch (error) {
    console.error(`Could not read Notifications: ${getErrorMessage(error)}`);
    throw data(FEED_UNAVAILABLE_MESSAGE, { status: 503 });
  }
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  return <FeedView feed={loaderData.feed} userId={loaderData.userId} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 503) {
    return <FeedUnavailable />;
  }

  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    title = error.status === 401 ? "Sign in required" : `Error ${error.status}`;
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
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
        <div className="text-lg font-medium">{FEED_UNAVAILABLE_MESSAGE}</div>
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

function ignoreFailure() {
  // The change-failed announcement rolls the page back and shows the message.
}

function FeedView({
  feed,
  userId,
}: {
  feed: NotificationFeed;
  userId: number;
}) {
  const [loadedFeed, setLoadedFeed] = useState(feed);
  const [readState, setReadState] = useState(() =>
    readStateFromFeed(feed, isAllReadSettling(userId))
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const { items, unreadCount } = readState;

  // A new load (retry, or a switched user) replaces what is on screen.
  if (feed !== loadedFeed) {
    setLoadedFeed(feed);
    setReadState(readStateFromFeed(feed, isAllReadSettling(userId)));
    setSelectedId(null);
    setFilter(null);
    setChangeError(null);
  }

  // Mark all read applies here wherever it started, including the bell's
  // dropdown, and so does its failure.
  useEffect(
    () =>
      subscribeToNotificationChanges((change) => {
        if (change.kind === "all-read") {
          setReadState(markAllReadInState);
        } else if (change.kind === "change-failed") {
          if (change.failed !== "all-read") return;
          setReadState(undoAllReadInState);
          setChangeError(ALL_READ_FAILED_MESSAGE);
        }
      }),
    []
  );

  function changeRead(item: NotificationFeedItem, read: boolean) {
    setChangeError(null);
    setReadState((current) => setItemReadInState(current, item.id, read));
    setNotificationRead(item.id, read).catch(() => {
      setReadState((current) => setItemReadInState(current, item.id, !read));
      setChangeError(CHANGE_FAILED_MESSAGE);
    });
  }

  function select(item: NotificationFeedItem) {
    setSelectedId(item.id);
    if (!item.read) changeRead(item, true);
  }

  function handleMarkAllRead() {
    setChangeError(null);
    markAllRead(userId).catch(ignoreFailure);
  }

  const labels = [
    ...new Set(
      items.map((item) => getNotificationTypeDetails(item.type).label)
    ),
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

      {changeError && (
        <p role="alert" className="border-b px-8 py-2 text-sm text-destructive">
          {changeError}
        </p>
      )}

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <Bell className="size-14 opacity-25" />
          <div className="text-lg font-medium text-foreground">
            Nothing here yet
          </div>
          <div className="max-w-sm text-sm">
            When something happens that concerns you, such as a Discussion Reply
            to your Discussion Question or a decision on your Refund Request, it
            will show up here.
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
