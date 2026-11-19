import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_NOTIFICATION_FEED } from "~/lib/notification-feed";
import { getNotificationFeed } from "~/lib/notifier.server";
import { getCurrentUserId } from "~/lib/session";
import { loader } from "./notifications";

vi.mock("~/lib/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("~/lib/notifier.server", () => ({ getNotificationFeed: vi.fn() }));

type LoaderArgs = Parameters<typeof loader>[0];

function load() {
  const request = new Request("http://cadence.test/notifications");
  return loader({ request } as unknown as LoaderArgs);
}

beforeEach(() => {
  vi.mocked(getCurrentUserId).mockReset();
  vi.mocked(getNotificationFeed).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Notification Feed page loader", () => {
  it("returns the signed-in person's feed", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(7);
    vi.mocked(getNotificationFeed).mockResolvedValue(EMPTY_NOTIFICATION_FEED);

    await expect(load()).resolves.toEqual({
      feed: EMPTY_NOTIFICATION_FEED,
      userId: 7,
    });
  });

  it("throws a 503 when the feed can't be read", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(7);
    vi.mocked(getNotificationFeed).mockRejectedValue(
      new Error("Knock is down")
    );

    await expect(load()).rejects.toMatchObject({
      data: "Couldn't load your Notifications",
      init: { status: 503 },
    });
  });

  it("keeps its 401 for someone signed out", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);

    await expect(load()).rejects.toMatchObject({
      data: "Select a user from the DevUI panel to see Notifications.",
      init: { status: 401 },
    });
  });
});
