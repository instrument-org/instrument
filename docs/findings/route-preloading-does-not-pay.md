# Preloading a route's code does not pay in a desktop app

**Status:** closed as working-as-designed, measured 2026-10-10. Nothing beyond the new tab's warmup is preloaded, and nothing should be until a screen measures otherwise.

## Context

TanStack Router's usual answer to slow navigation is `preload="intent"`: hovering a `<Link>` fetches the route's split chunk and runs its loader. Studio turns that off (`defaultPreload: false` in [router.tsx](../../apps/studio/src/client/router.tsx) and [tab-router.ts](../../apps/studio/src/client/lib/tab-router.ts)), and it would do little if it were on:

- Almost no navigation goes through `<Link>`. Screens open through `openScreen` and `appTabs.open`, which never trigger router preloading.
- No route has a `loader`. Data comes from `useQuery` inside components, so router preloading could only fetch code.
- Routes are split by `autoCodeSplitting`, and every chunk is read from the app bundle on local disk.

The one preload in the app is in [app-window.tsx](../../apps/studio/src/client/components/window/app-window.tsx): it fetches the new tab's chunk and prefetches the `places` query as the window comes up. Whether more screens deserved the same treatment is what was measured.

## How it was measured

A production renderer build (Vite dev serves unbundled modules, which says nothing about chunk cost), booted against a copy-on-write clone of a real workspace with about 390 chats, on an M5 Max. A measurement-only drive hook called the router's own `loadRouteChunk`, the same call a shipped preload would make. Each navigation was timed from the history push until the DOM had been quiet for 700 ms, with long-animation-frame entries captured alongside. Medians of four or five runs.

Expect roughly double these times on a slower Mac. The conclusions are about ratios and do not change.

## What we found

**With the code cache warm (every launch after the first), a preloaded chunk saves 2 to 13 ms.** Times in ms:

| Screen | Cold | Chunk preloaded |
| --- | --- | --- |
| Files | 47 | 44 |
| Task list | 27 | 22 |
| Task | 55 | 51 |
| Apps | 50 | 42 |
| App | 34 | 21 |
| Browser | 16 | 12 |

**Right after an update, with V8's code cache empty, the saving is 0 to 20 ms per screen**, and preloading all seven route chunks at boot costs about 20 ms. That is a wash. Route chunks are 6 to 90 KB, and reading and compiling one from local disk takes single-digit milliseconds.

**Chat data is not worth prefetching on hover either.** Chats have no route chunk (the window shell draws them), so the only candidate is their data. A first open against a revisit:

| Chat | First open | Revisit |
| --- | --- | --- |
| Small | ~65 | ~42 |
| 1.4 MB `task.db` | ~250 | ~205 |
| 730 KB `task.db` | ~155 | ~126 |

At most about 45 ms is data. The rest is rendering the transcript, which a prefetch does not touch, while a fetch on every hover over the sidebar would cost something.

**The one slow screen is slow on the network.** Release notes take 170 to 470 ms with or without a preload, because `releases.list` calls the GitHub API. Prefetching it when the "just updated" toast appears was considered and declined: waiting on that screen is acceptable.

## What this means

- Keep `defaultPreload: false`, and do not add route chunk warmups. The new tab's warmup is worth keeping for its `places` prefetch, which stops the page from growing a section at a time; the chunk load beside it is harmless.
- A screen that feels slow to open is waiting on data or on rendering, not on code. Measure which before reaching for a preload.
- Prefetch data only at a moment that predicts the next screen, and only when the wait it hides is one a person would notice.
