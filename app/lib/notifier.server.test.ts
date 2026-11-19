import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationFeed } from "./notification-feed";
import {
  getNotificationFeed,
  getUnreadCount,
  knockTransport,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  NotificationNotFoundError,
  outboxNotificationTransport,
  sendNotifications,
  type Notification,
  type NotificationTransport,
  type OutgoingNotification,
} from "./notifier.server";

const refundApproved: Notification = {
  type: "refund_request_approved",
  actorId: 1,
  recipientIds: [2],
  title: "Refund approved",
  body: "Your refund request for Test Course was approved, and your refund is on its way.",
  url: "/settings#refund-requests",
};

const refundDeclined: Notification = {
  ...refundApproved,
  type: "refund_request_declined",
  recipientIds: [3],
  title: "Refund declined",
};

function fakeTransport(overrides: Partial<NotificationTransport> = {}) {
  const sent: OutgoingNotification[] = [];
  const transport: NotificationTransport = {
    async send(notification) {
      sent.push(notification);
    },
    async getUnreadCount() {
      return 0;
    },
    async listFeed() {
      return { items: [], unreadCount: 0, totalCount: 0 };
    },
    async ownsNotification() {
      return true;
    },
    async markRead() {},
    async markUnread() {},
    async markAllRead() {},
    ...overrides,
  };
  return { sent, transport };
}

function never() {
  return new Promise<never>(() => {});
}

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sendNotifications", () => {
  it("sends each recipient as an id object, with no name or email", async () => {
    const { sent, transport } = fakeTransport();

    await sendNotifications([refundApproved], transport);

    expect(sent).toEqual([
      {
        type: "refund_request_approved",
        recipients: [{ id: "2" }],
        title: "Refund approved",
        body: "Your refund request for Test Course was approved, and your refund is on its way.",
        url: "/settings#refund-requests",
      },
    ]);
  });

  it("removes the actor from the recipients", async () => {
    const { sent, transport } = fakeTransport();

    await sendNotifications(
      [{ ...refundApproved, actorId: 2, recipientIds: [2, 5] }],
      transport
    );

    expect(sent[0].recipients).toEqual([{ id: "5" }]);
  });

  it("sends nothing when the actor was the only recipient", async () => {
    const { sent, transport } = fakeTransport();

    await sendNotifications(
      [{ ...refundApproved, actorId: 2, recipientIds: [2] }],
      transport
    );

    expect(sent).toEqual([]);
  });

  it("logs a failed send and still sends the others", async () => {
    const { sent, transport } = fakeTransport();
    const send = transport.send;
    transport.send = async (notification, signal) => {
      if (notification.type === "refund_request_approved") {
        throw new Error("Knock said no");
      }
      await send(notification, signal);
    };

    await expect(
      sendNotifications([refundApproved, refundDeclined], transport)
    ).resolves.toBeUndefined();

    expect(sent.map((notification) => notification.type)).toEqual([
      "refund_request_declined",
    ]);
    expect(logged).toHaveBeenCalledOnce();
  });

  it("stops waiting for a send that hangs, and logs it", async () => {
    const { transport } = fakeTransport({ send: never });

    await expect(
      sendNotifications([refundApproved], transport, 10)
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledOnce();
  });

  it("sends concurrently, so a hung send doesn't hold up the next", async () => {
    const { sent, transport } = fakeTransport();
    const send = transport.send;
    transport.send = (notification, signal) =>
      notification.type === "refund_request_approved"
        ? never()
        : send(notification, signal);

    await sendNotifications([refundApproved, refundDeclined], transport, 10);

    expect(sent.map((notification) => notification.type)).toEqual([
      "refund_request_declined",
    ]);
  });

  it("writes to the outbox when Knock isn't configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "notification-outbox-"));

    await sendNotifications(
      [refundApproved, refundDeclined],
      outboxNotificationTransport(directory)
    );

    const written = readdirSync(directory).map((file) =>
      JSON.parse(readFileSync(join(directory, file), "utf8"))
    );
    expect(written).toHaveLength(2);
    expect(written).toContainEqual(
      expect.objectContaining({
        type: "refund_request_approved",
        recipients: [{ id: "2" }],
        title: "Refund approved",
        url: "/settings#refund-requests",
      })
    );
  });
});

describe("getUnreadCount", () => {
  it("returns the signed-in person's own count", async () => {
    const asked: number[] = [];
    const { transport } = fakeTransport({
      async getUnreadCount(userId) {
        asked.push(userId);
        return 4;
      },
    });

    await expect(getUnreadCount(7, transport)).resolves.toBe(4);
    expect(asked).toEqual([7]);
  });

  it("lets a read failure reach the caller", async () => {
    const { transport } = fakeTransport({
      getUnreadCount: async () => {
        throw new Error("Knock is down");
      },
    });

    await expect(getUnreadCount(7, transport)).rejects.toThrow("Knock is down");
  });

  it("lets a read timeout reach the caller", async () => {
    const { transport } = fakeTransport({ getUnreadCount: never });

    await expect(getUnreadCount(7, transport, 10)).rejects.toThrow(
      "did not respond"
    );
  });

  it("is zero, without an error, when Knock isn't configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "notification-outbox-"));

    await expect(
      getUnreadCount(7, outboxNotificationTransport(directory))
    ).resolves.toBe(0);
  });
});

describe("the test suite", () => {
  it("never reaches Knock, even when a key is in the environment", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getUnreadCount(7)).resolves.toBe(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("knockTransport", () => {
  const signal = new AbortController().signal;

  function fakeKnock(status: number, body: unknown) {
    const requests: { method?: string; url: string; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        method: init?.method,
        url: String(input),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Response.json(body, { status });
    };
    return {
      requests,
      transport: knockTransport(
        "test-key",
        "test-workflow",
        "test-feed",
        fetchImpl
      ),
    };
  }

  it("triggers the workflow with id-only recipients and the content as data", async () => {
    const { requests, transport } = fakeKnock(200, { workflow_run_id: "run" });

    await transport.send(
      {
        type: "refund_request_approved",
        recipients: [{ id: "2" }],
        title: "Refund approved",
        body: "Body",
        url: "/settings#refund-requests",
      },
      signal
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/v1/workflows/test-workflow/trigger");
    expect(requests[0].body).toEqual({
      recipients: [{ id: "2" }],
      data: {
        type: "refund_request_approved",
        title: "Refund approved",
        body: "Body",
        url: "/settings#refund-requests",
      },
    });
  });

  it("does not retry a failed send", async () => {
    const { requests, transport } = fakeKnock(500, { message: "Broken" });

    await expect(
      transport.send(
        {
          type: "refund_request_approved",
          recipients: [{ id: "2" }],
          title: "Refund approved",
          body: "Body",
          url: "/settings#refund-requests",
        },
        signal
      )
    ).rejects.toThrow();

    expect(requests).toHaveLength(1);
  });

  it("reads the whole feed's unread count from a one-item request", async () => {
    const { requests, transport } = fakeKnock(200, {
      entries: [],
      meta: { unread_count: 12, unseen_count: 99, total_count: 30 },
      page_info: { page_size: 1 },
    });

    await expect(transport.getUnreadCount(7, signal)).resolves.toBe(12);

    expect(requests[0].url).toContain("/v1/users/7/feeds/test-feed");
    expect(requests[0].url).toContain("page_size=1");
  });

  it("does not retry a failed read", async () => {
    const { requests, transport } = fakeKnock(429, { message: "Slow down" });

    await expect(transport.getUnreadCount(7, signal)).rejects.toThrow();

    expect(requests).toHaveLength(1);
  });

  function feedEntry(overrides: Record<string, unknown> = {}) {
    return {
      id: "message-1",
      inserted_at: "2026-11-18T10:00:00Z",
      read_at: null,
      data: {
        type: "refund_request_approved",
        title: "Refund approved",
        body: "Your refund is on its way.",
        url: "/settings#refund-requests",
      },
      ...overrides,
    };
  }

  function feedResponse(entries: unknown[]) {
    return {
      entries,
      meta: { unread_count: 3, unseen_count: 99, total_count: 8 },
      page_info: { page_size: 50 },
    };
  }

  it("maps feed items back to their content, read state and counts", async () => {
    const { requests, transport } = fakeKnock(
      200,
      feedResponse([
        feedEntry(),
        feedEntry({ id: "message-2", read_at: "2026-11-18T11:00:00Z" }),
      ])
    );

    await expect(transport.listFeed(7, 10, signal)).resolves.toEqual({
      unreadCount: 3,
      totalCount: 8,
      items: [
        {
          id: "message-1",
          type: "refund_request_approved",
          title: "Refund approved",
          body: "Your refund is on its way.",
          url: "/settings#refund-requests",
          read: false,
          createdAt: "2026-11-18T10:00:00Z",
        },
        {
          id: "message-2",
          type: "refund_request_approved",
          title: "Refund approved",
          body: "Your refund is on its way.",
          url: "/settings#refund-requests",
          read: true,
          createdAt: "2026-11-18T10:00:00Z",
        },
      ],
    });
    expect(requests[0].url).toContain("/v1/users/7/feeds/test-feed");
    expect(requests[0].url).toContain("page_size=10");
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "/\t/evil.example/phish",
    "javascript:alert(1)",
    "settings",
  ])("drops the link %j, which isn't inside Cadence", async (url) => {
    const { transport } = fakeKnock(
      200,
      feedResponse([
        feedEntry({
          data: { ...feedEntry().data, url },
        }),
      ])
    );

    const feed = await transport.listFeed(7, 10, signal);

    expect(feed.items[0].url).toBeNull();
  });

  it("keeps the path, query and fragment of a link inside Cadence", async () => {
    const url = "/courses/react/lessons/4?tab=discussion#comment-9";
    const { transport } = fakeKnock(
      200,
      feedResponse([feedEntry({ data: { ...feedEntry().data, url } })])
    );

    const feed = await transport.listFeed(7, 10, signal);

    expect(feed.items[0].url).toBe(url);
  });

  it("leaves out a feed item that doesn't carry Notification content", async () => {
    const { transport } = fakeKnock(
      200,
      feedResponse([feedEntry({ id: "broken", data: null }), feedEntry()])
    );

    const feed = await transport.listFeed(7, 10, signal);

    expect(feed.items.map((item) => item.id)).toEqual(["message-1"]);
  });

  it("marks one message read and unread", async () => {
    const { requests, transport } = fakeKnock(200, {});

    await transport.markRead("message-1", signal);
    await transport.markUnread("message-1", signal);

    expect(requests.map(({ method, url }) => [method, new URL(url).pathname]))
      .toEqual([
        ["PUT", "/v1/messages/message-1/read"],
        ["DELETE", "/v1/messages/message-1/read"],
      ]);
  });

  it("always scopes mark all read to the recipient", async () => {
    const { requests, transport } = fakeKnock(200, { status: "queued" });

    await transport.markAllRead(7, signal);

    expect(new URL(requests[0].url).pathname).toBe(
      "/v1/channels/test-feed/messages/bulk/read"
    );
    expect(requests[0].body).toEqual({ recipient_ids: ["7"] });
  });

  it.each([
    ["their own message", { recipient: "7", channel_id: "test-feed" }, true],
    ["someone else's", { recipient: "8", channel_id: "test-feed" }, false],
    ["another channel's", { recipient: "7", channel_id: "email" }, false],
    [
      "an object recipient's",
      {
        recipient: { id: "7", collection: "teams" },
        channel_id: "test-feed",
      },
      false,
    ],
  ])("decides ownership of %s", async (_name, message, expected) => {
    const { requests, transport } = fakeKnock(200, message);

    await expect(
      transport.ownsNotification(7, "message-1", signal)
    ).resolves.toBe(expected);
    expect(new URL(requests[0].url).pathname).toBe("/v1/messages/message-1");
  });

  it("treats a message Knock can't find as not the person's", async () => {
    const { transport } = fakeKnock(404, { message: "Not found" });

    await expect(
      transport.ownsNotification(7, "missing", signal)
    ).resolves.toBe(false);
  });

  it("lets other failures while checking ownership through", async () => {
    const { transport } = fakeKnock(500, { message: "Broken" });

    await expect(
      transport.ownsNotification(7, "message-1", signal)
    ).rejects.toThrow();
  });
});

describe("changing read state", () => {
  function recordingTransport(ownerId = 7) {
    const changes: string[] = [];
    const { transport } = fakeTransport({
      ownsNotification: async (userId) => userId === ownerId,
      async markRead(id) {
        changes.push(`read ${id}`);
      },
      async markUnread(id) {
        changes.push(`unread ${id}`);
      },
      async markAllRead(userId) {
        changes.push(`all read for ${userId}`);
      },
    });
    return { changes, transport };
  }

  it("marks a person's own Notification read", async () => {
    const { changes, transport } = recordingTransport();

    await markNotificationRead(7, "message-1", transport);

    expect(changes).toEqual(["read message-1"]);
  });

  it("marks a person's own Notification unread", async () => {
    const { changes, transport } = recordingTransport();

    await markNotificationUnread(7, "message-1", transport);

    expect(changes).toEqual(["unread message-1"]);
  });

  it("won't change a Notification belonging to someone else", async () => {
    const { changes, transport } = recordingTransport(8);

    await expect(
      markNotificationRead(7, "message-1", transport)
    ).rejects.toBeInstanceOf(NotificationNotFoundError);
    await expect(
      markNotificationUnread(7, "message-1", transport)
    ).rejects.toBeInstanceOf(NotificationNotFoundError);

    expect(changes).toEqual([]);
  });

  it("marks all read for that person only", async () => {
    const { changes, transport } = recordingTransport();

    await markAllNotificationsRead(7, transport);

    expect(changes).toEqual(["all read for 7"]);
  });

  it("lets a failed change reach the caller", async () => {
    const { transport } = fakeTransport({
      markAllRead: async () => {
        throw new Error("Knock is down");
      },
    });

    await expect(markAllNotificationsRead(7, transport)).rejects.toThrow(
      "Knock is down"
    );
  });

  it("stops waiting for a change that hangs", async () => {
    const { transport } = fakeTransport({ ownsNotification: never });

    await expect(
      markNotificationRead(7, "message-1", transport, 10)
    ).rejects.toThrow("did not respond");
  });

  it("does nothing, without an error, when Knock isn't configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "notification-outbox-"));
    const transport = outboxNotificationTransport(directory);

    await expect(
      markNotificationRead(7, "message-1", transport)
    ).resolves.toBeUndefined();
    await expect(
      markNotificationUnread(7, "message-1", transport)
    ).resolves.toBeUndefined();
    await expect(
      markAllNotificationsRead(7, transport)
    ).resolves.toBeUndefined();

    expect(readdirSync(directory)).toEqual([]);
  });
});

describe("getNotificationFeed", () => {
  const feed: NotificationFeed = { items: [], unreadCount: 2, totalCount: 5 };

  it("reads the signed-in person's own feed", async () => {
    const asked: number[] = [];
    const { transport } = fakeTransport({
      async listFeed(userId) {
        asked.push(userId);
        return feed;
      },
    });

    await expect(getNotificationFeed(7, 10, transport)).resolves.toEqual(feed);
    expect(asked).toEqual([7]);
  });

  it("lets a read failure reach the caller", async () => {
    const { transport } = fakeTransport({
      listFeed: async () => {
        throw new Error("Knock is down");
      },
    });

    await expect(getNotificationFeed(7, 10, transport)).rejects.toThrow(
      "Knock is down"
    );
  });

  it("lets a read timeout reach the caller", async () => {
    const { transport } = fakeTransport({ listFeed: never });

    await expect(getNotificationFeed(7, 10, transport, 10)).rejects.toThrow(
      "did not respond"
    );
  });

  it("is empty, without an error, when Knock isn't configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "notification-outbox-"));

    await expect(
      getNotificationFeed(7, 10, outboxNotificationTransport(directory))
    ).resolves.toEqual({ items: [], unreadCount: 0, totalCount: 0 });
  });
});
