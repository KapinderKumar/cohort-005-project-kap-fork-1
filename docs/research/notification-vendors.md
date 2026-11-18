# Hosted vendors for headless in-app Notifications

Research for [issue #12](https://github.com/KapinderKumar/cohort-005-project-kap-fork-1/issues/12) (map: [#11](https://github.com/KapinderKumar/cohort-005-project-kap-fork-1/issues/11)). Sources were read on 2026-11-18. Pricing pages change often, so check them again before signing up.

**Question.** Which hosted SaaS vendors can power Cadence's in-app Notifications through a headless API? Cadence builds its own Inbox UI with shadcn and will not use vendor React components. The recipients are Students, Instructors, Platform Admins and Team Admins. Email support only breaks ties.

**Scope.** Knock, Novu Cloud, MagicBell, Courier and SuprSend. I didn't research any other vendors in depth (see [Not covered](#not-covered)). This document lays out the options and doesn't pick one, because a separate grilling ticket makes that call.

---

## Knock

- **Free tier:** 10,000 messages per month. Knock defines a message as "a single message delivered to a single user on a single channel", so in-app messages count and in-app plus email counts as two. The free tier includes unlimited isolated environments. The next plan, Starter, costs $250/month plus usage. Source: [knock.app/pricing](https://knock.app/pricing)
- **Server SDK:** `@knocklabs/node` is generated with Stainless. You trigger with `client.workflows.trigger(key, { recipients, data })`. The client options include `apiKey`, `maxRetries`, `timeout`, `logger` and a custom `fetch`. Source: [knock-node README](https://github.com/knocklabs/knock-node)
- **Headless feed fetch:**
  - **Server side:** `client.users.feeds.listItems(userId, channelId, params)` calls `GET /v1/users/{user_id}/feeds/{channel_id}`, so a React Router loader can call it with the secret key. Pagination uses cursors (`after`, `before`, `page_size` with a default of 50). The response metadata includes `total_count`, `unread_count` and `unseen_count`. Sources: [knock-node api.md](https://github.com/knocklabs/knock-node/blob/main/api.md), [List feed items](https://docs.knock.app/api-reference/users/feeds/list_items)
  - **Client side:** `@knocklabs/client` (no React) exposes a `FeedClient` with a state store. Source: [Custom UI](https://docs.knock.app/in-app-ui/feeds/custom-ui)
- **Read state:**
  - **States:** unseen, seen, read, interacted and archived. Archived messages are hidden from the default feed and can be unarchived. Sources: [Knock in-app channel](https://docs.knock.app/integrations/in-app/knock), [Feeds overview](https://docs.knock.app/in-app-ui/feeds/overview)
  - **Client methods:** `FeedClient` has `markAsSeen/Unseen/Read/Unread/Interacted/Archived/Unarchived`, `markAllAsSeen`, `markAllAsRead`, `markAllAsArchived` and `markAllReadAsArchived`. Source: [feed.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts)
  - **Server methods:** `messages.markAsRead`/`markAsSeen`/`archive`, `messages.batch.*`, and `channels.bulk.updateMessageStatus(channelId, action, filters)` (`POST /v1/channels/{channel_id}/messages/bulk/{action}`). The bulk call filters by `recipient_ids` and `engagement_status`. Sources: [api.md](https://github.com/knocklabs/knock-node/blob/main/api.md), [Channels API](https://docs.knock.app/api-reference/channels)
  - **Caveat:** the Channels API page names only `archive`/`unarchive` as example actions, so it doesn't explicitly confirm a server-side bulk "read" action.
- **Real-time:** Knock runs a managed WebSocket service that pushes a `new-message` event. The event carries metadata and badge counts but not the full message, and it may be throttled. Source: [In-app API overview](https://docs.knock.app/in-app-ui/api-overview)
- **Recipients:**
  - Knock recommends using your own internal user id as the user `id` (up to 256 characters, no `/` or `#`, immutable). `id` is the only required field.
  - Users are persisted when they are sent a notification, and you can identify them inline when you trigger. Source: [Users](https://docs.knock.app/concepts/users)
- **Client auth:** the public key plus a user id works out of the box. For production, Knock says to turn on "enhanced security", where your backend signs an RS256 JWT with `signUserToken(userId)` from `@knocklabs/node`. Source: [Security & authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- **Environments:** you start with Production and can enable Development, then add more. Each environment has its own API keys and its own data. You commit workflow changes and promote them from one environment to the next. Source: [Environments](https://docs.knock.app/concepts/environments)
- **Retention:** feed items are available indefinitely. Logs are kept for 30 days on Free and Starter. Source: [Data retention](https://docs.knock.app/manage-your-account/data-retention)
- **Stubbing:** the custom `fetch` client option lets tests inject a fake transport. Because the feed is fetched from the server, a loader can sit behind a small Cadence-owned interface, so no browser socket is needed in tests.
- **Email:** yes, as a workflow channel.

## Novu Cloud

- **Free tier:**
  - 10,000 workflow runs per month, up to 5 workflows and 3 team members, unlimited subscribers, and 2 environments (Dev and Prod). The activity feed is kept for 24 hours. Pro starts at $30/month and Team at $250/month. Source: [novu.co/pricing](https://novu.co/pricing)
  - The Inbox feed is kept for 30 days on Free and 90 days on Pro and Team. Source: [Platform limits](https://docs.novu.co/platform/developer/limits.md)
- **Server SDK:** `@novu/api` is generated with Speakeasy and has a "Custom HTTP Client" section. You trigger with `novu.trigger({ workflowId, to: { subscriberId, ... } })`. Sources: [novu-ts README](https://github.com/novuhq/novu-ts), [Subscribers](https://docs.novu.co/platform/concepts/subscribers.md)
- **Headless feed fetch:**
  - **Client side (primary path):** `@novu/react` offers headless hooks (`useNotifications`, `useCounts`, `useNovu`), and `@novu/js` is a browser SDK that doesn't depend on any UI framework. `@novu/js` provides `notifications.list` (filters `read`, `archived`, `tags`, dates), `count`, `read`/`unread`, `seen` (one-way), `archive`/`unarchive`, `readAll`, `seenAll`, `archiveAll`, `archiveAllRead` and `snooze`. Sources: [Headless mode](https://docs.novu.co/platform/inbox/headless-mode.md), [@novu/js](https://docs.novu.co/platform/sdks/javascript)
  - **Server side:** the REST API has v2 subscriber endpoints for counts, mark read/unread, mark all read (`POST /v2/subscribers/{id}/notifications/read`), mark seen, archive/archive-all, snooze and delete. **However, the only documented endpoint that lists a subscriber's feed is `GET /v1/subscribers/{subscriberId}/notifications/feed`, and it is marked deprecated ("use v2 API instead").** I found no v2 list endpoint in the API reference index. The non-deprecated alternative is the environment-wide `List all messages`, filtered by `subscriberId` and channel. Sources: [Retrieve subscriber notifications (deprecated)](https://docs.novu.co/api-reference/subscribers/retrieve-subscriber-notifications.md), [Mark all as read](https://docs.novu.co/api-reference/subscribers/mark-all-notifications-as-read.md), [List all messages](https://docs.novu.co/api-reference/messages/list-all-messages.md)
- **Read state:** read/unread, seen (no unseen), archived/unarchived, snoozed and deleted. The bulk operations are read-all, seen-all, archive-all and archive-all-read. Source: [@novu/js](https://docs.novu.co/platform/sdks/javascript)
- **Real-time:** WebSocket, with the events `notifications.notification_received` and `notifications.unread_count_changed`. `socketUrl` can be overridden. Source: [@novu/js](https://docs.novu.co/platform/sdks/javascript)
- **Recipients:** the `subscriberId` is defined by your app, and Novu says to "use your application's internal user ID". Triggering creates the subscriber just in time, or updates it if it already exists. Source: [Subscribers](https://docs.novu.co/platform/concepts/subscribers.md)
- **Client auth:** `applicationIdentifier` plus `subscriberId`. For production, Novu says to enable HMAC, where `subscriberHash = HMAC-SHA256(secretKey, subscriberId)` is computed on the server. Source: [Prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production.md)
- **Environments:** Development and Production, plus custom environments on paid plans. Each environment has its own API keys. Sources: [pricing](https://novu.co/pricing), [Create an environment](https://docs.novu.co/api-reference/environments/create-an-environment.md)
- **Stubbing:** the custom HTTP client in `@novu/api` covers the trigger path. The feed path runs mostly in the browser through hooks and a socket, so tests would mock `@novu/react` or sit behind a Cadence-owned adapter. That is harder if Cadence wants loader-side reads, because the server list endpoint is deprecated.
- **Other:** Novu is open source, so self-hosting is a possible escape hatch. Source: [What is Novu](https://docs.novu.co/platform/what-is-novu.md)
- **Email:** yes.

## MagicBell

- **Free tier:** the free plan is called "Builder". It allows **1,000 deliveries per month** and 1 project, with unlimited users. Startup costs $249/month for 50,000 deliveries. Source: [magicbell.com/pricing](https://www.magicbell.com/pricing)
- **Server SDK:** `magicbell-js/project-client`, authenticated with a project access token. You create notifications with `client.broadcasts.createBroadcast(...)` (`POST /v2/broadcasts`), which takes 1–1,000 recipients by `external_id` or email. `saveUser` (`PUT /users`) creates or updates a user. Sources: [magicbell-js](https://www.magicbell.com/docs/libraries/magicbell-js), [API v2 reference](https://www.magicbell.com/docs/api/reference)
- **Headless feed fetch:**
  - `magicbell-js/user-client` has `listNotifications` (`GET /v2/notifications`, with filters for status, category and topic), `fetchUnreadNotificationsCount`, `markNotificationRead`/`Unread`, `archiveNotification`/`unarchive`, `markAllNotificationsRead` and `archiveAllNotifications`.
  - The client needs a **user JWT**, which your backend signs locally (HS256, with the project secret, `user_external_id` or `user_email`, and `api_key`). A loader can therefore mint a token and call the user API from the server.
  - Sources: [magicbell-js](https://www.magicbell.com/docs/libraries/magicbell-js), [User auth](https://www.magicbell.com/docs/api/authentication/user)
- **Read state:** read/unread and archived. The v2 reference lists "Mark a notification seen" and "Mark all notifications seen", but I couldn't confirm their paths from the page excerpt. Source: [API v2 reference](https://www.magicbell.com/docs/api/reference)
- **Real-time:** `Realtime` client over WebSocket (`new Realtime({ token })`, `listen(cb)`, auto-reconnect). Source: [magicbell-js](https://www.magicbell.com/docs/libraries/magicbell-js)
- **Recipients:** `external_id` is your own id. The docs don't say whether a broadcast creates unknown users automatically, so `saveUser` would be the safe choice.
- **Environments:** the free plan has 1 project. I found no built-in dev/prod split, so a second environment presumably means a second project.
- **Stubbing:** it's a plain REST API with locally signed JWTs, so it's straightforward to put behind an adapter.
- **Email:** yes, through integrations.

## Courier

- **Free tier:** the Developer plan allows up to 10,000 sends per month. One template delivered across email and in-app "still counts as one send". **Test-environment sends count the same as Production.** Business costs $0.005 per send. The pricing page lists custom environments as Enterprise, but the docs say a workspace can have up to 20 environments (see below), so this needs checking. Source: [courier.com/pricing](https://www.courier.com/pricing)
- **Server SDK:** `@trycourier/courier` (v7+). You send with `client.send.message(...)`. Sources: [courier-node README](https://github.com/trycourier/courier-node), [llms.txt](https://www.courier.com/docs/llms.txt)
- **Headless feed fetch:**
  - `@trycourier/courier-js` is a browser SDK "without UI components". `new CourierClient({ userId, jwt })` gives you `inbox.getMessages({ filter: { tags, archived, status, from } })`, `getArchivedMessages`, `getUnreadMessageCount` and `getUnreadCounts(filtersMap)`.
  - The JWT is minted by your backend with `client.auth.issueToken({ scope: "user_id:<id> inbox:read:messages inbox:write:events", expires_in })`.
  - Sources: [Courier JS SDK](https://www.courier.com/docs/sdk-libraries/courier-js-web.md), [Authenticate users](https://www.courier.com/docs/in-app/authenticate-users.md)
  - **Unverified:** I didn't confirm that `courier-js` runs inside a Node loader. It is documented as a browser SDK, and I found no documented server-side endpoint for listing inbox messages.
- **Read state:**
  - **Methods:** `read`, `unread`, `open` (Courier's closest equivalent to "seen"), `click`, `archive`, `unarchive`, `readAll`, `archiveRead` and `archiveAll`. Source: [Courier JS SDK](https://www.courier.com/docs/sdk-libraries/courier-js-web.md)
  - **Persistence:** read, opened and archived states sync across devices. Messages stay in the feed until they're archived or reach their `expiresAt`. Source: [Inbox runtime behavior](https://www.courier.com/docs/in-app/how-the-inbox-behaves.md)
- **Real-time:** once the user signs in, the client opens a real-time socket connection that uses the same JWT. The custom-UI docs say to "connect the inbox WebSocket and refetch counts when message events arrive". Sources: [Inbox runtime behavior](https://www.courier.com/docs/in-app/how-the-inbox-behaves.md), [Courier JS SDK](https://www.courier.com/docs/sdk-libraries/courier-js-web.md)
- **Recipients:** "The `user_id` is yours, not Courier's… Nothing has to exist in Courier first, since signing in registers the user." Source: [Authenticate users](https://www.courier.com/docs/in-app/authenticate-users.md)
- **Environments:** every workspace starts with Production and Test, and can have up to 20 environments. Each environment has its own keys, templates and logs, and billing counts sends from all of them. Test comes with an email provider that only delivers to the signup address. Courier also has draft keys (`dk_`) for rendering unpublished templates. Source: [Environments and API keys](https://www.courier.com/docs/workspaces/environments.md)
- **Stubbing:** sends are easy to put behind an adapter. The feed path depends on the browser SDK and its socket, so tests would mock `courier-js`.
- **Email:** strongest of the five. Email is the centre of Courier's product, and its Test environment includes a sandbox email provider.

## SuprSend

- **Free tier:** 10,000 notifications per month. It includes the in-app feed "with SuprSend branding" and multiple environments, but not multiple projects. Essentials costs $100/month. Source: [suprsend.com/pricing](https://www.suprsend.com/pricing)
- **Server SDK:** `@suprsend/node-sdk`, created with `new Suprsend(workspaceKey, workspaceSecret)`. You trigger with `supr_client.workflows.trigger(new WorkflowTriggerRequest(body))`, which "doesn't require user creation beforehand". Source: [suprsend-node-sdk README](https://github.com/suprsend/suprsend-node-sdk)
- **Headless feed fetch:**
  - **Client side:** use `@suprsend/react-core` for headless hooks (`SuprSendFeedProvider`, `useFeedData`, `useFeedClient`, `useFeed`), or `@suprsend/web-sdk` without React (`suprSendClient.identify(id, userToken)`, `feeds.initialize()`, `fetch()`, `fetchNextPage()`). Sources: [React headless feed](https://docs.suprsend.com/docs/react-sdk-headless-feed.md), [JS in-app feed](https://docs.suprsend.com/docs/js-inapp-feed.md)
  - **Server side:** `List Messages` (`GET`, with filters `channel=inbox` and `recipient_id[]`) is described as a workspace message log, not a user-facing feed API. `PATCH /v1/bulk/message/` takes message ids and supports `read`, `unread`, `archived`, `unarchived` and `seen` for inbox. Sources: [List Messages](https://docs.suprsend.com/reference/list-messages.md), [Bulk update](https://docs.suprsend.com/reference/bulk-update-messages.md)
- **Read state:** `markAsSeen`, `markAsRead`, `markAsUnread`, `markAsArchived`, `markAsInteracted` and `markAllAsRead`. The notification object includes `seen_on` and `archived`. Source: [JS in-app feed](https://docs.suprsend.com/docs/js-inapp-feed.md)
- **Real-time:** `feedClient.initializeSocketConnection()` opens a socket.io connection. There is also optional "reachability" status for the socket and the API. Source: [JS in-app feed](https://docs.suprsend.com/docs/js-inapp-feed.md)
- **Recipients:** `distinct_id` is your own id. `Create / Update Users` upserts by `distinct_id`, and triggering doesn't require creating the user first. Sources: [Create/Update users](https://docs.suprsend.com/reference/create-update-users.md), [node SDK README](https://github.com/suprsend/suprsend-node-sdk)
- **Client auth:** a public key, plus a signed user JWT when "Enhanced Security Mode" is on (ES256, `entity_type: "subscriber"`, `entity_id: distinct_id`). There is also a refresh callback. Source: [Client authentication](https://docs.suprsend.com/docs/client-authentication.md)
- **Environments:** every account comes with three isolated workspaces: Sandbox (a trial with capped usage), Staging and Production. Staging has a **Test Mode** that delivers only to internal testers. Assets are promoted by cloning, the CLI or the Management API. Source: [Workspaces](https://docs.suprsend.com/docs/workspaces.md)
- **Stubbing:** the trigger path is easy to put behind an adapter. The feed path depends on the browser SDK and its socket, so tests would mock it.
- **Email:** yes.

---

## Summary table

| | Knock | Novu Cloud | MagicBell | Courier | SuprSend |
|---|---|---|---|---|---|
| Free tier | 10k msgs/mo (in-app counts per channel) | 10k workflow runs/mo, 5 workflows | **1k deliveries/mo**, 1 project | 10k sends/mo (Test counts too) | 10k notifs/mo, Inbox branded |
| First paid tier | $250/mo | $30/mo | $249/mo | $0.005/send | $100/mo |
| Node trigger SDK | `@knocklabs/node` | `@novu/api` | `magicbell-js/project-client` | `@trycourier/courier` | `@suprsend/node-sdk` |
| Loader-side feed read | **Yes, documented** (`users.feeds.listItems`) | Only via **deprecated** v1 endpoint | Yes (user JWT minted locally) | Not documented (browser SDK) | Only as message log |
| Headless client lib | `@knocklabs/client` | `@novu/js` / `@novu/react` hooks | `magicbell-js/user-client` | `@trycourier/courier-js` | `@suprsend/web-sdk` / `react-core` |
| States | unseen/seen/read/interacted/archived | read/seen/archived/snoozed | read/archived (+seen) | read/opened/clicked/archived | seen/read/interacted/archived |
| Mark all read | Client `markAllAsRead`; server bulk by channel | `readAll` + REST v2 | `markAllNotificationsRead` | `readAll` | `markAllAsRead` (client) |
| Real-time | WebSocket (`new-message`) | WebSocket | WebSocket | WebSocket | socket.io |
| Own user id as recipient | Yes | Yes (JIT create) | Yes (`external_id`) | Yes (JWT registers) | Yes (`distinct_id`) |
| Dev/test envs on free | Unlimited | Dev + Prod | 1 project | Prod + Test (20 per docs) | Sandbox + Staging + Prod, Test Mode |
| Client auth | RS256 JWT (enhanced security) | HMAC of subscriberId | HS256 JWT | Courier-issued scoped JWT | ES256 JWT |

## Trade-offs to weigh

1. **Loader-side reads or browser-side reads.** Knock (and MagicBell, because its user JWT is minted locally) fit a React Router loader that fetches the feed on the server and renders shadcn components. Novu, Courier and SuprSend are built around a browser SDK with a live store and socket. Choosing them means a client-side data layer for the Inbox and a socket in the browser, or relying on a deprecated or log-oriented server endpoint.
2. **Real-time requires the browser no matter what.** Every vendor's real-time path is a client socket. If Cadence wants live badge counts, some vendor client code will run in the browser, even with loader-side reads.
3. **Cost curve.** Novu is cheapest to step up from ($30/mo). Knock and MagicBell jump to about $250/mo. Courier is per-send, so it grows with usage. MagicBell's 1k free deliveries is the tightest limit for development and a pilot cohort.
4. **Environments and test safety.** Knock (unlimited) and SuprSend (three workspaces, Test Mode) separate environments the most cleanly on free plans. Courier counts Test sends against billing. MagicBell's free plan has one project.
5. **Metering differences.** Knock and SuprSend count each channel delivery. Courier counts a multi-channel template as one send. Novu counts workflow runs. If email is added later, these give different bills for the same traffic.
6. **Lock-in and escape hatches.** Novu is open source and can be self-hosted. The others are SaaS only. Every vendor lets you use your own user id, so changing vendor later mostly means rewriting triggers and the Inbox adapter, not migrating ids.
7. **Testability.** For all five, the low-cost path is a Cadence-owned `Notifications` interface with a fake in tests. Vendors with a server-side read API (Knock, MagicBell) let the fake cover reads as well. Browser-SDK vendors also need component-level mocks.
8. **Email (tiebreaker).** Courier is the most email-centric and has a sandbox email provider in Test. All five support email.

## Not covered

- I found other hosted options (for example GetStream Activity Feeds, Engagespot and NotificationAPI) but didn't research them, so this document makes no claims about them.
- Open questions to check directly before deciding:
  - Whether Knock's server-side bulk action accepts `read`. The client-side `markAllAsRead` exists either way.
  - Whether Novu has a v2 list endpoint for a subscriber's feed.
  - Whether Courier's `courier-js` runs in Node.
  - The paths of MagicBell's "mark seen" endpoints.
  - Courier's environment limit on the free plan, where pricing and docs disagree.
