// PROTOTYPE — throwaway. Wayfinder ticket "Prototype the Inbox UI".
// Three variants of the Inbox on the existing app shell, switchable via `?variant=A|B|C`.
// Fake, in-memory Notifications drawn from the decided catalogue, filtered by the
// DevUI user's role (and Team Admin status). `?empty=1` shows the empty state.
// Nothing here talks to Knock or the database.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router";
import { Popover, Dialog } from "radix-ui";
import {
  Bell,
  BellOff,
  CheckCheck,
  CircleDollarSign,
  GraduationCap,
  Inbox as InboxIcon,
  MessageCircleQuestion,
  MessageSquareReply,
  Receipt,
  Star,
  UserPlus,
  X,
  ArrowRight,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { UserRole } from "~/db/schema";

// ─── Fake data ──────────────────────────────────────────────────────────────

type NotificationType =
  | "refund-decided"
  | "new-refund-request"
  | "new-question"
  | "new-answer"
  | "seat-claimed"
  | "course-rated"
  | "new-enrollment";

export interface FakeNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  linkLabel: string;
  minutesAgo: number;
  read: boolean;
}

const typeMeta: Record<NotificationType, { icon: React.ReactNode; label: string; tone: string }> = {
  "refund-decided": { icon: <CircleDollarSign className="size-4" />, label: "Refund", tone: "text-emerald-600 bg-emerald-500/10" },
  "new-refund-request": { icon: <Receipt className="size-4" />, label: "Refund Request", tone: "text-amber-600 bg-amber-500/10" },
  "new-question": { icon: <MessageCircleQuestion className="size-4" />, label: "Question", tone: "text-sky-600 bg-sky-500/10" },
  "new-answer": { icon: <MessageSquareReply className="size-4" />, label: "Answer", tone: "text-sky-600 bg-sky-500/10" },
  "seat-claimed": { icon: <UserPlus className="size-4" />, label: "Seat", tone: "text-violet-600 bg-violet-500/10" },
  "course-rated": { icon: <Star className="size-4" />, label: "Rating", tone: "text-yellow-600 bg-yellow-500/10" },
  "new-enrollment": { icon: <GraduationCap className="size-4" />, label: "Enrollment", tone: "text-indigo-600 bg-indigo-500/10" },
};

function fakeFor(role: UserRole | null, isTeamAdmin: boolean): FakeNotification[] {
  const n: Omit<FakeNotification, "id">[] = [];
  if (role === UserRole.Student) {
    n.push(
      { type: "new-answer", title: "Your Question was answered", body: "Sarah Chen answered “Why does useEffect run twice in dev?” on Effects in Depth.", link: "/courses", linkLabel: "View Answer", minutesAgo: 4, read: false },
      { type: "refund-decided", title: "Refund approved", body: "Your Refund Request for Advanced TypeScript was approved. “Sorry it wasn’t a fit — refund issued.”", link: "/dashboard", linkLabel: "View purchase", minutesAgo: 95, read: false },
      { type: "new-answer", title: "Your Question was answered", body: "Platform Admin answered “Is there a transcript for lesson 3?”", link: "/courses", linkLabel: "View Answer", minutesAgo: 60 * 26, read: true },
      { type: "refund-decided", title: "Refund declined", body: "Your Refund Request for CSS Mastery was declined. “You’ve watched past the Watch Limit.”", link: "/dashboard", linkLabel: "View purchase", minutesAgo: 60 * 24 * 6, read: true },
    );
  }
  if (isTeamAdmin) {
    n.push(
      { type: "seat-claimed", title: "Seat claimed", body: "Priya Patel claimed a Seat on your React Fundamentals Team Licence (7 of 10 used).", link: "/team", linkLabel: "View team", minutesAgo: 12, read: false },
      { type: "seat-claimed", title: "Seat claimed", body: "Tom Okafor claimed a Seat on your React Fundamentals Team Licence (6 of 10 used).", link: "/team", linkLabel: "View team", minutesAgo: 60 * 30, read: true },
    );
  }
  if (role === UserRole.Instructor) {
    n.push(
      { type: "new-question", title: "New Question", body: "Alex Rivera asked on Hooks › useReducer: “When should I reach for useReducer over useState?”", link: "/instructor/questions", linkLabel: "Answer it", minutesAgo: 2, read: false },
      { type: "new-enrollment", title: "New Enrollment", body: "Jamie Lee enrolled in React Fundamentals (Individual Purchase).", link: "/instructor", linkLabel: "View students", minutesAgo: 18, read: false },
      { type: "new-question", title: "New Question", body: "Morgan Smith asked on Routing › Loaders: “Can a loader return a redirect?”", link: "/instructor/questions", linkLabel: "Answer it", minutesAgo: 47, read: false },
      { type: "course-rated", title: "Course rated", body: "Priya Patel rated React Fundamentals ★★★★☆ (changed from ★★★☆☆).", link: "/instructor/analytics", linkLabel: "View analytics", minutesAgo: 60 * 5, read: true },
      { type: "new-enrollment", title: "New Enrollment", body: "Tom Okafor enrolled in React Fundamentals (Claimed Seat, Acme Corp).", link: "/instructor", linkLabel: "View students", minutesAgo: 60 * 28, read: true },
      { type: "course-rated", title: "Course rated", body: "Alex Rivera rated Advanced TypeScript ★★★★★.", link: "/instructor/analytics", linkLabel: "View analytics", minutesAgo: 60 * 24 * 3, read: true },
    );
  }
  if (role === UserRole.Admin) {
    n.push(
      { type: "new-refund-request", title: "New Refund Request", body: "Jamie Lee requested a Refund for Advanced TypeScript (Individual Purchase, $49).", link: "/admin/refunds", linkLabel: "Review request", minutesAgo: 7, read: false },
      { type: "new-refund-request", title: "New Refund Request", body: "Acme Corp requested a Refund for a React Fundamentals Team Licence (10 Seats, $390).", link: "/admin/refunds", linkLabel: "Review request", minutesAgo: 60 * 3, read: false },
      { type: "new-refund-request", title: "New Refund Request", body: "Morgan Smith requested a Refund for CSS Mastery (Individual Purchase, $29).", link: "/admin/refunds", linkLabel: "Review request", minutesAgo: 60 * 24 * 2, read: true },
    );
  }
  return n
    .sort((a, b) => a.minutesAgo - b.minutesAgo)
    .map((x, i) => ({ ...x, id: `n${i}` }));
}

function ago(m: number) {
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 60 / 24)}d ago`;
}

// ─── In-memory store (lives in the layout, so read state survives variant switches) ──

interface Store {
  items: FakeNotification[];
  unread: number;
  markRead: (id: string) => void;
  toggleRead: (id: string) => void;
  markAllRead: () => void;
}
const InboxCtx = createContext<Store | null>(null);
const useInbox = () => useContext(InboxCtx)!;

export function InboxPrototypeProvider({
  role,
  isTeamAdmin,
  children,
}: {
  role: UserRole | null;
  isTeamAdmin: boolean;
  children: React.ReactNode;
}) {
  const [params] = useSearchParams();
  const empty = !!params.get("empty");
  const [items, setItems] = useState(() => fakeFor(role, isTeamAdmin));
  useEffect(() => setItems(fakeFor(role, isTeamAdmin)), [role, isTeamAdmin]);
  const shown = empty ? [] : items;
  const store = useMemo<Store>(
    () => ({
      items: shown,
      unread: shown.filter((i) => !i.read).length,
      markRead: (id) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read: true } : x))),
      toggleRead: (id) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read: !x.read } : x))),
      markAllRead: () => setItems((xs) => xs.map((x) => ({ ...x, read: true }))),
    }),
    [shown]
  );
  return <InboxCtx.Provider value={store}>{children}</InboxCtx.Provider>;
}

export const inboxVariants = [
  { key: "A", name: "Bell + popover" },
  { key: "B", name: "Side sheet" },
  { key: "C", name: "Full page" },
];

function Badge({ n, className }: { n: number; className?: string }) {
  if (n === 0) return null;
  return (
    <span className={cn("flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white", className)}>
      {n > 9 ? "9+" : n}
    </span>
  );
}

function TypeIcon({ type, className }: { type: NotificationType; className?: string }) {
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", typeMeta[type].tone, className)}>
      {typeMeta[type].icon}
    </span>
  );
}

// ─── Variant A: bell with badge in the sidebar header, compact popover ──────
// Click a Notification → mark read + navigate. Mark-all-read in the popover header.

export function VariantABell() {
  const { items, unread, markRead, markAllRead } = useInbox();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const viewAll = new URLSearchParams(params);
  viewAll.set("inbox", "1");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" title="Inbox">
          <Bell className="size-5" />
          <Badge n={unread} className="absolute -right-0.5 -top-0.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="right" align="start" sideOffset={12} className="z-50 w-96 rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="font-semibold">Inbox</div>
            <Button variant="ghost" size="xs" disabled={unread === 0} onClick={markAllRead}>
              <CheckCheck /> Mark all read
            </Button>
          </div>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
              <BellOff className="size-8 opacity-40" />
              <div className="font-medium text-foreground">You’re all caught up</div>
              <div>Notifications about your courses, Questions and Refunds will show up here.</div>
            </div>
          ) : (
            <ul className="max-h-[28rem] divide-y overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      markRead(n.id);
                      setOpen(false);
                      navigate(n.link);
                    }}
                    className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-accent", !n.read && "bg-primary/5")}
                  >
                    <TypeIcon type={n.type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("truncate text-sm", !n.read ? "font-semibold" : "text-muted-foreground")}>{n.title}</span>
                        {!n.read && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                      </div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground/70">{ago(n.minutesAgo)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t p-2">
            <NavLink
              to={`?${viewAll}`}
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1 rounded-md py-1.5 text-sm font-medium text-primary hover:bg-accent"
            >
              View all Notifications <ArrowRight className="size-4" />
            </NavLink>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Variant B: "Inbox" nav item with count → full-height right sheet ───────
// Unread / All tabs, Today / Earlier grouping, per-item read/unread toggle on hover.

export function VariantBNavItem() {
  const { items, unread, markRead, toggleRead, markAllRead } = useInbox();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const visible = tab === "unread" ? items.filter((i) => !i.read) : items;
  const groups = [
    { label: "Today", items: visible.filter((i) => i.minutesAgo < 60 * 24) },
    { label: "Earlier", items: visible.filter((i) => i.minutesAgo >= 60 * 24) },
  ].filter((g) => g.items.length);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <InboxIcon className="size-4" />
          Inbox
          <Badge n={unread} className="ml-auto" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[28rem] flex-col border-l bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Dialog.Title className="text-lg font-semibold">Inbox</Dialog.Title>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={unread === 0} onClick={markAllRead}>
                <CheckCheck /> Mark all read
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon-sm"><X /></Button>
              </Dialog.Close>
            </div>
          </div>
          <div className="flex gap-1 border-b px-5 py-2">
            {(["unread", "all"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("rounded-full px-3 py-1 text-sm capitalize", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
                {t}{t === "unread" && unread > 0 ? ` (${unread})` : ""}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {groups.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <InboxIcon className="size-10 opacity-30" />
                <div className="font-medium text-foreground">{tab === "unread" && items.length ? "No unread Notifications" : "Your Inbox is empty"}</div>
                {tab === "unread" && items.length > 0 && (
                  <button className="text-primary underline-offset-4 hover:underline" onClick={() => setTab("all")}>Show all</button>
                )}
              </div>
            ) : (
              groups.map((g) => (
                <section key={g.label}>
                  <div className="sticky top-0 bg-muted/80 px-5 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">{g.label}</div>
                  {g.items.map((n) => (
                    <div key={n.id} className="group relative flex gap-3 border-b px-5 py-4 hover:bg-accent/50">
                      {!n.read && <span className="absolute left-0 top-0 h-full w-1 bg-primary" />}
                      <TypeIcon type={n.type} />
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          markRead(n.id);
                          setOpen(false);
                          navigate(n.link);
                        }}
                      >
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{typeMeta[n.type].label} · {ago(n.minutesAgo)}</div>
                        <div className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</div>
                        <div className="text-sm text-muted-foreground">{n.body}</div>
                      </button>
                      <button
                        onClick={() => toggleRead(n.id)}
                        className="self-start rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
                      >
                        Mark {n.read ? "unread" : "read"}
                      </button>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Variant C: "Inbox" nav item → full page in the main area, two panes ────
// Selecting a Notification marks it read and shows it on the right; click-through is an
// explicit button, not the row. Type filter chips across the top.

export function VariantCNavItem() {
  const { unread } = useInbox();
  const [params] = useSearchParams();
  const active = !!params.get("inbox");
  const next = new URLSearchParams(params);
  next.set("inbox", "1");
  return (
    <NavLink
      to={`?${next}`}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <InboxIcon className="size-4" />
      Inbox
      {unread > 0 && <span className="ml-auto text-xs font-semibold text-primary">{unread}</span>}
    </NavLink>
  );
}

export function VariantCPage() {
  const { items, unread, markRead, toggleRead, markAllRead } = useInbox();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationType | "all">("all");
  const types = [...new Set(items.map((i) => i.type))];
  const visible = filter === "all" ? items : items.filter((i) => i.type === filter);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-8 py-5">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-muted-foreground">{unread} unread of {items.length}</p>
        </div>
        <Button variant="outline" disabled={unread === 0} onClick={markAllRead}>
          <CheckCheck /> Mark all read
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <InboxIcon className="size-14 opacity-25" />
          <div className="text-lg font-medium text-foreground">Nothing here yet</div>
          <div className="max-w-sm text-sm">When something happens that concerns you — an Answer to your Question, a decision on your Refund Request — it lands here.</div>
        </div>
      ) : (
        <>
          <div className="flex gap-2 border-b px-8 py-3">
            <Chip on={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
            {types.map((t) => (
              <Chip key={t} on={filter === t} onClick={() => setFilter(t)}>{typeMeta[t].label}</Chip>
            ))}
          </div>
          <div className="flex min-h-0 flex-1">
            <ul className="w-[26rem] shrink-0 overflow-y-auto border-r">
              {visible.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      setSelectedId(n.id);
                      markRead(n.id);
                    }}
                    className={cn(
                      "flex w-full items-start gap-3 border-b px-6 py-3 text-left",
                      selectedId === n.id ? "bg-accent" : "hover:bg-accent/50"
                    )}
                  >
                    <span className={cn("mt-2 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-sm", !n.read && "font-semibold")}>{n.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{ago(n.minutesAgo)}</span>
                      </div>
                      <div className="truncate text-sm text-muted-foreground">{n.body}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex-1 overflow-y-auto p-10">
              {selected ? (
                <div className="max-w-xl space-y-4">
                  <div className="flex items-center gap-3">
                    <TypeIcon type={selected.type} className="size-10" />
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{typeMeta[selected.type].label} · {ago(selected.minutesAgo)}</div>
                      <h2 className="text-xl font-semibold">{selected.title}</h2>
                    </div>
                  </div>
                  <p className="text-base">{selected.body}</p>
                  <div className="flex gap-2">
                    <Button onClick={() => navigate(selected.link)}>
                      {selected.linkLabel} <ArrowRight />
                    </Button>
                    <Button variant="ghost" onClick={() => toggleRead(selected.id)}>
                      Mark {selected.read ? "unread" : "read"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a Notification</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
      {children}
    </button>
  );
}
