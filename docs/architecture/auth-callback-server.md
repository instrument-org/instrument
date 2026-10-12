# Auth callback server

Studio receives browser sign-in results on an HTTP server bound to `127.0.0.1`. [server.ts](../../apps/studio/src/electron-main/auth/server.ts) constructs the Hono app separately from binding the listener, so tests can send requests through every registered handler without Electron or a listening socket.

## Route ownership

[routes.ts](../../apps/studio/src/electron-main/auth/routes.ts) owns the canonical loopback paths. Authorization URL builders and callback handlers use those values. Every GET route, including assets and previews, passes through a registration guard that rejects duplicate paths before the listener starts.

| Path | Owner |
| --- | --- |
| `/auth/callback` | ChatGPT |
| `/auth/callback/instrument` | Instrument account sign-in |
| `/auth/callback/openrouter` | OpenRouter |
| `/auth/callback/app` | Connected apps |

ChatGPT retains its registered redirect path, with only the port varying when another listener occupies the preferred port. The authorization request and token exchange use the same exact redirect URI.

## Instrument sign-in

[client.ts](../../apps/studio/src/electron-main/auth/client.ts) requests `callback_version=2` when starting Instrument sign-in through the API, which then returns the browser to `/auth/callback/instrument`. An API that ignores that parameter returns to `/auth/callback`, where ChatGPT's handler answers with the expired page because the state is not its own.

Each handler checks the callback state against its own pending transaction, so a stale callback never consumes another flow's. A recognized Instrument callback consumes its state and verifier before exchange, and publishes its success, decline, or failure to the waiting app.

## Verification

[server.test.ts](../../apps/studio/src/electron-main/auth/server.test.ts) exercises the assembled router, including a ChatGPT callback while Instrument sign-in is pending, an Instrument state arriving at ChatGPT's path, exchange failure and replay, unknown states, and the other provider routes. Provider-specific tests cover token exchange and cancellation separately.
