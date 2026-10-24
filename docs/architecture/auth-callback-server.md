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
| `/open` | The website's Open Instrument buttons |

ChatGPT retains its registered redirect path, with only the port varying when another listener occupies the preferred port. The authorization request and token exchange use the same exact redirect URI.

## Instrument sign-in

[client.ts](../../apps/studio/src/electron-main/auth/client.ts) requests `callback_version=2` when starting Instrument sign-in through the API, which then returns the browser to `/auth/callback/instrument`. An API that ignores that parameter returns to `/auth/callback`, where ChatGPT's handler answers with the expired page because the state is not its own.

## Continuing on the website

The API's exchange may name `next`, a page on the website that takes the account from there (its plan pages, while the API's `plansOnWebsite` setting is on and the account has no plan or trial). [client.ts](../../apps/studio/src/electron-main/auth/client.ts) keeps `next` only when it is on the website this build talks to (`continueOnWebsite`: tryinstrument.com and its subdomains over HTTPS, or localhost for a local API) and adds the loopback's `port`; the Instrument callback then redirects the browser there instead of rendering the signed-in page, and leaves the window where it is. `signInSocial` answers `on-web`, and `auth.finishOnWeb` waits until billing shows a plan or a running trial, the website's "Use your existing subscriptions" opens `/open?step=subscriptions`, the person cancels in the app, or half an hour passes. The website builds `/open` only from a validated port on `127.0.0.1`, and nothing secret rides on it: a forged link can do no more than bring the window forward.

## Plans on the website

Studio shows no plans and runs no Checkout, trial or plan change itself; it reads `billing.status` and `billing.offer` and sends every way to buy, start or change a plan to the website. `billing.openWebsite` ([billing.ts](../../apps/studio/src/electron-main/rpc/routes/billing.ts)) opens `/welcome` (`plans`: choosing a plan or starting a trial, with `plan` leading when given) or `/account` (`account`: changing or resuming the plan, and Stripe's billing portal), each with the loopback's `port` so its Open Instrument button can reach `/open`. Signed in, [web-link.ts](../../apps/studio/src/electron-main/platform-api/web-link.ts) asks the API's `/auth/web-link/create` for a single-use link that signs the browser in on the way; signed out, or when the API refuses, the page opens unsigned on the website that goes with the API (`websiteBaseUrl`). With `wait`, the call starts the same wait a sign-in the website took over has, so setup's and the log-in dialog's See plans hold on `auth.finishOnWeb` until a plan or a trial lands. Everything else that opens the website (the chat's notes, the model picker, dictation, Settings › Account) does not wait: billing is read again when the window regains focus (`useBillingStatus`).

## Pending sign-ins

Google, ChatGPT, and OpenRouter each keep their waiting sign-in in one [loopback-sign-in.ts](../../apps/studio/src/electron-main/auth/loopback-sign-in.ts) instance: at most one waits at a time, starting another supersedes it, each carries its own random `state`, and ChatGPT's and OpenRouter's end on their own after five minutes. Each provider exposes a `receive…Callback(params)` that hands the redirect to its waiting sign-in and returns the promise of how it finished, or undefined when the state is not its own, so a stale callback never consumes another flow's. The sign-in itself runs the exchange and keeps what it gets; the server only renders the page for the outcome.

## Verification

[server.test.ts](../../apps/studio/src/electron-main/auth/server.test.ts) exercises the assembled router, including a ChatGPT callback while Instrument sign-in is pending, an Instrument state arriving at ChatGPT's path, a failed exchange, unknown states, and the other provider routes. [loopback-sign-in.test.ts](../../apps/studio/src/electron-main/auth/loopback-sign-in.test.ts) covers state matching, superseding, and the timeout; provider-specific tests cover token exchange and cancellation separately.
