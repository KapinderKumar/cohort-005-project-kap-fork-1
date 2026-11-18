# Use Knock for in-app Notifications

Cadence sends and reads Notifications through Knock, a hosted service, on its free plan. Cadence's own Notification Feed UI loads a person's Notifications on the server, in a React Router loader, with Knock's `users.feeds.listItems`. Knock is the only vendor we compared that documents a server-side, non-deprecated way to list one person's Notifications, and its free plan gives 10,000 messages a month across unlimited separate environments.

## Considered Options

- **MagicBell.** It can also be read from the server, because its user tokens are signed locally. Rejected because its free plan allows only 1,000 deliveries a month in a single project, which is too few to develop and run a pilot on.
- **Novu Cloud.** Its first paid plan is the cheapest ($30/month against Knock's $250), and it is open source. Rejected because its only server endpoint for listing a person's Notifications is deprecated, and self-hosting is out of scope (ADR 0006).
- **Courier, SuprSend.** Both expect the browser to read Notifications through their SDK and a socket. Neither documents a server-side way to list them.

## Consequences

- Knock's $250/month first paid plan was deliberately set aside. If usage outgrows the free plan, revisit this decision.
- Every vendor lets Cadence use its own user ids, so switching later means rewriting the code that sends Notifications and the code the Notification Feed uses to read them. No user ids have to move.
- Real-time delivery played no part in this choice, because every vendor offers it.
