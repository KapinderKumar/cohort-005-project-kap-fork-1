import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUnreadCount,
  knockTransport,
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
    const requests: { url: string; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
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
});
