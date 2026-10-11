# Plan: sign in through the API, and run without one

Status: sign-in through the API is built on both sides. Running without an API and notices are not started.

Studio signs in to Instrument with Google by running the whole Google flow in the main process: an `arctic.Google` client (`apps/studio/src/electron-main/auth/client.ts`) opens the user's browser, the loopback server (`auth/server.ts`) trades the code for tokens with the Desktop client's secret, and only the ID token goes on to the API's better-auth. That is Google's documented installed-app pattern, and Google still requires the secret for a Desktop client even with PKCE. But the app never uses Google's access or refresh tokens; Google only proves who is signing in, and the API is the one that cares. So the secret ships in every build, rotating it takes a release, and a production build refuses to start without `MAIN_VITE_GOOGLE_CLIENT_ID` and `MAIN_VITE_GOOGLE_CLIENT_SECRET` (`electron.vite.config.ts`), which is the first wall someone building the open repo hits.

This plan moves the Google flow onto the API, lets the app run with no API at all, and gives the API a way to put a notice in front of a build that needs one.

## Sign-in through the API

The API runs Google's flow with its web client, the one the website already signs in with, whose secret never leaves the server. Studio holds no Google configuration.

1. Studio starts its loopback server as today, makes a `state` and a PKCE verifier, and opens `${API}/auth-desktop/start?port=<port>&state=<state>&code_challenge=<S256 challenge>` in the user's browser.
2. The API keeps the port, state and challenge in a short-lived cookie and sends the browser to Google through a third better-auth instance at `/auth-desktop`. It uses the web client's credentials like `/auth-web`, but allows sign-up, since the app is where accounts are made. Its callback, `${API}/auth-desktop/callback/google`, is registered on the web client for each environment.
3. Google returns to the API and better-auth signs the person in, creating the account on a first sign-in exactly as the ID-token path does now (same hooks, same tables). The finish route reads that session, issues a single-use token with better-auth's `one-time-token` plugin, records the challenge beside it, and redirects to `http://127.0.0.1:<port>/auth/callback?token=<token>&state=<state>`. Only a loopback host and a numeric port are accepted, so the API can't be steered into sending a token anywhere else.
4. Studio checks `state`, posts the token and the verifier to the API, and gets back the session token it stores today (`sessionStore.set("apiBearerToken", …)`). A token read off the loopback by another local process is useless without the verifier.

Because the session is made in the browser, the browser is also signed in to the website afterward. That's expected: it's the same account.

A declined consent comes back the same way (`?error=access_denied&state=…`), so the existing declined, expired and failed pages in `auth/page.ts` keep their jobs. Cancel and the single-pending-sign-in rule in `signInSocial` are unchanged; only the URL it opens and what the callback does with what comes back change.

Studio then drops `arctic`'s Google client, both `MAIN_VITE_GOOGLE_*` variables from `validate-env.ts`, `.env.local.example`, `.agents/env.md`, `turbo.json`, and the `preview.yml`, `release.yml` and `smoke-test.yml` workflows. Which sign-in providers exist becomes the API's answer: another provider is server work plus a button.

**Rollout.** The endpoint ships first, then the Studio change in the next build. Earlier builds are not kept working: once current builds sign in through the API, the Desktop Google client and the ID-token sign-in path come out of the API.

## Running without an API

`MAIN_VITE_APP_API_BASE_URL` becomes optional. Unset, the app has no Instrument account: onboarding goes straight to choosing a provider, the Instrument provider and its models are hidden, web search through the API is off, ChatGPT sign-in uses `BUILT_IN_SIGN_IN_SETUP` without asking, and sign-in buttons are not shown. Every `import.meta.env.MAIN_VITE_APP_API_BASE_URL` reader goes through one accessor that answers "no API" instead of building a URL from `undefined`.

This is different from the API being down, which `platform-api/reachability.ts` already handles in development with the corner badge. No API is a configuration; unreachable is a moment.

The production-build check in `electron.vite.config.ts` stops requiring the Google variables. Official release workflows still set the API URL, so a release can't go out pointed at nothing by accident; that guard belongs in the workflow, not in every production build.

## Notices from the API

The API answers `GET /client/notices` with what a build should show its user. The request carries the `Instrument/<version> (<platform>; <arch>)` user agent every platform request sends (`platform-api/headers.ts`) and nothing else; the API matches notices to the version range and platform and returns only the ones that apply.

A notice is `{ id, severity: "info" | "warning" | "critical", title, body, action?: { label, url } }`. Studio asks at launch and every few hours, shows `info` and `warning` notices as rows under the bell in [window-notices.md](window-notices.md), and shows `critical` ones as a banner across the window that can't be dismissed until the build no longer matches. Dismissing a notice is remembered by `id`. The action URL opens in the user's browser.

FP-1166's minimum-version and recommended-version answer (`appUpdates.get`) is one kind of notice, and folds into this endpoint rather than becoming a second one.

The response schema is permissive and only ever grows (unknown fields ignored, unknown severities shown as `warning`), because the point is to reach builds that never upgrade: the first build that ships this must still understand a notice written years later. A failed or malformed response shows nothing and retries on the next interval.

## Order

1. API: the desktop sign-in endpoint and the code exchange. Touches better-auth configuration and sessions only.
2. API: `/client/notices`, served from configuration rather than a database table to start.
3. Studio: sign-in through the API, Google variables removed.
4. Studio: optional API, and the production-build check.
5. Studio: notices, once the bell from window-notices.md exists, or as a plain banner before it.

## Open questions

- Whether a notice can open the bell on its own, and whether "you're on the newest version" after an update is a notice or a toast.
- Whether notices ride the same launch request as anything else the app fetches from the API at startup, or stay their own request.
