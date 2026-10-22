# Plan: Sign in with Apple

Status: planned, not started. The API side (provider, route, session records) is its own plan in the platform API repository, `docs/plans/active/sign-in-with-apple-readiness.md`; this one covers what Studio and a future iPhone app do and what people see.

Studio signs in with Google only, through the browser handoff in [`sign-in-through-the-api.md`](sign-in-through-the-api.md). Adding Apple gives people a sign-in that can keep their email private, and an iPhone app needs it anyway: App Store guideline 4.8 asks any app offering a social login like Google's to also offer one that "allows users to keep their email address private as part of setting up their account", and Sign in with Apple is the one that meets it.

## On the desktop, Apple rides the Google handoff

Apple's native sign-in sheet (`ASAuthorizationController`) is not available to Studio. In Apple's [supported capabilities table for macOS](https://developer.apple.com/help/account/reference/supported-capabilities-macos/), Sign in with Apple is checked for the App Store program and left empty for Developer ID, which is how Studio is signed; the provisioning profile Studio embeds grants keychain groups only. So Apple goes through the same browser handoff Google does:

1. Studio opens the API's start route in the browser with `provider=apple`, alongside the PKCE challenge, state and loopback port it already sends (`apps/studio/src/electron-main/auth/client.ts`).
2. Apple's web sign-in runs in the browser and comes back to the API, which redirects to Studio's loopback callback with a one-time token.
3. Studio trades the token and its verifier for a session token exactly as it does after Google.

Nothing changes in the loopback server, the exchange, or how the token is stored and sent. The Windows and Linux builds get Apple sign-in the same way, which a native Mac sheet would not have given them.

What people see depends on their browser. Safari shows Apple's own sheet, which signs in with Touch ID. Chrome and other browsers show Apple's web form: Apple Account, password, then a code from a trusted device, which Apple lets them skip on that browser for 30 days afterward.

## What changes in Studio

- Onboarding offers "Continue with Apple" beside "Continue with Google", under the same caption (setup's free-account step, `apps/studio/src/client/components/setup/steps/free-account.tsx`, and the log-in page, `components/studio-modals/instrument-log-in.tsx`). The Google button is `ConnectButton` (`connect-button.tsx`), which takes a provider and runs its connect hook (`hooks/use-connect.ts`), so Apple gets a hook of its own and shares the pending state, the answers and retry.
- The account card in Settings offers both wherever it offers logging in today.
- The start URL carries the provider; the rest of `auth/client.ts` stays as it is.
- The headers Studio already sends with the exchange (`platform-api/headers.ts`) are how the API learns which client made a session, so they must keep going on that request.

## Hide My Email

A person who signs in with Apple can hide their address. We then get a relay address ending in `privaterelay.appleid.com` (newer ones end in `private.icloud.com`) that forwards to them, and Apple bounces mail to it from any sender we have not registered: "If you don't register all the source domains or emails that you use, email sent to the private relay service will result in a bounce message." Before Apple ships, the API plan registers every sender that mails a person: the domain our account and product email comes from, and the address payment receipts come from.

Two more consequences for the app:

- **The name arrives once.** Apple sends the person's name only on the first authorization. The API keeps it then; Studio never asks Apple for it again.
- **Two accounts for one person.** Someone who signs in with Google on one computer and with Apple and a hidden address on another gets two accounts, since the relay address never matches their Gmail. A "link your other sign-in" control in Settings fixes that later; until then, the account card should name which provider an account uses, so the person can tell which one they are in.

## The iPhone app signs in natively

On the iPhone, Apple is native: the system's Sign in with Apple button returns an identity token, which the app sends to the API's social sign-in with that token, with no browser. Google goes through the API like the desktop, in an `ASWebAuthenticationSession` sheet that returns to the app's `instrument://` scheme, so there is one Google client and one flow on every platform rather than Google's iOS SDK and a client of its own.

The App Store build also needs account deletion inside the app (guideline 5.1.1(v)), and deleting an Apple account means revoking its tokens with Apple. Both are in the API's account deletion plan.

## Open question

Apple's article on Sign in with Apple for the web says "you must have an existing app in the App Store that uses Sign in with Apple", while its account help asks only to associate the website with an existing App ID enabled for Sign in with Apple. Settle it in the developer portal before building: if the first holds, desktop Apple waits for the iPhone app.

## Build order

1. The API records which client made each session, and its sign-in events carry provider and client, so Apple's effect on sign-ups can be measured.
2. The API upgrades better-auth and adds the Apple provider, the renamed route with its old one kept as an alias, and the registered mail senders.
3. Studio's provider-aware handoff button, in onboarding and Settings.
4. The iPhone app's native Apple button and Google through the API, with account deletion, before it goes to review.
5. Linking the other provider from Settings.
