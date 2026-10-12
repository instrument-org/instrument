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

## Instrument compatibility

[client.ts](../../apps/studio/src/electron-main/auth/client.ts) requests `callback_version=2` when starting Instrument sign-in through the API. Its canonical loopback callback is `/auth/callback/instrument`. An API that does not support that version can return to `/auth/callback`; that route dispatches to the Instrument handler only when the callback state matches the pending Instrument transaction. Otherwise it passes the callback to ChatGPT, which validates its own pending state.

Token and code query parameters do not select a provider. A stale callback must not consume another flow's pending transaction. A recognized Instrument callback consumes its state and verifier before exchange, and publishes its success, decline, or failure to the waiting app.

## Verification

[server.test.ts](../../apps/studio/src/electron-main/auth/server.test.ts) exercises the assembled router, including a ChatGPT callback while Instrument sign-in is pending, canonical and compatibility Instrument callbacks, exchange failure and replay, unknown states, other provider routes, and deliberately colliding paths. Provider-specific tests cover token exchange and cancellation separately.
