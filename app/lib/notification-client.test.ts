import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationChange } from "./notification-client";

const USER_ID = 1;
const OTHER_USER_ID = 2;
const SETTLE_MS = 3000;

type Client = typeof import("./notification-client");

let client: Client;
let respond: (response: Response) => void;
let changes: NotificationChange[];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  // Every request waits, so each test decides when the server answers.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        })
    )
  );
  client = await import("./notification-client");
  changes = [];
  client.subscribeToNotificationChanges((change) => changes.push(change));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Mark all read settling", () => {
  it("isn't settling before anything is marked", () => {
    expect(client.isAllReadSettling(USER_ID)).toBe(false);
  });

  it("is settling from the moment Mark all read starts", () => {
    void client.markAllRead(USER_ID);

    expect(client.isAllReadSettling(USER_ID)).toBe(true);
  });

  it("keeps settling while Knock finishes, then stops", async () => {
    const request = client.markAllRead(USER_ID);
    vi.advanceTimersByTime(SETTLE_MS + 1000);
    expect(client.isAllReadSettling(USER_ID)).toBe(true);

    respond(new Response("{}"));
    await request;
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(client.isAllReadSettling(USER_ID)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(client.isAllReadSettling(USER_ID)).toBe(false);
  });

  it("stops settling, and says what failed, when Mark all read fails", async () => {
    const request = client.markAllRead(USER_ID);

    respond(new Response("", { status: 503 }));
    await expect(request).rejects.toThrow();

    expect(client.isAllReadSettling(USER_ID)).toBe(false);
    expect(changes).toEqual([
      { kind: "all-read" },
      { kind: "change-failed", failed: "all-read" },
    ]);
  });

  it("isn't settled by another person's Mark all read", () => {
    void client.markAllRead(USER_ID);

    expect(client.isAllReadSettling(OTHER_USER_ID)).toBe(false);
  });

  it("keeps settling when a single change fails", async () => {
    const allRead = client.markAllRead(USER_ID);
    respond(new Response("{}"));
    await allRead;

    const single = client.setNotificationRead("a", false);
    respond(new Response("", { status: 503 }));
    await expect(single).rejects.toThrow();

    expect(client.isAllReadSettling(USER_ID)).toBe(true);
    expect(changes.at(-1)).toEqual({
      kind: "change-failed",
      failed: "count-changed",
    });
  });
});
