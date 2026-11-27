# The folder trail's test cuts nothing on CI

**Status:** open. Listed in `scripts/ci-known-failures.json` until 2026-12-11 so landings onto the branch go through; take the entry out once the cause is fixed.

`folding-trail.browser.test.tsx` fails on CI's Linux Chromium in some runs and passes in others, with no change to `FoldingTrail` or its test in between: on `tab-groups-prototype` it failed on 18e534f7c, passed on 1d1ac1f10, and failed on c7b6e0659 and ff25f926d. All three tests fail together, each on all three retries.

## What fails

In every failing run the trail cuts nothing. The failure screenshot shows the 160px title clipped at its box with no ellipsis, so the first two tests never find a `.text-ellipsis` or `.sr-only` element. The third reports `expected 'Phase two drawings and quotes for the…' to match /^Phase .*…/`, which reads like a match, but the `…` there is Vitest shortening the printed value: the text is the whole name, uncut. So the trail measured its parts as fitting, or never measured.

## What was ruled out

- The file passes alone and in the full browser suite (134 files) on macOS at ff25f926d's successor ea4efc420, so it is not another test file leaking into it on this platform.
- Nothing the trail imports changed between the passing and failing runs.

## Leads

- Fonts: the test waits on `document.fonts.ready` before rendering, which resolves at once when the app font has not been requested yet. On Linux the fallback differs from macOS's, and `FoldingTrail` measures in its layout effect and again only when its box or its hidden copy resizes.
- Timing under CI load: the measuring effect and the `ResizeObserver` refit against `expect.poll`'s default timeout.

Reproducing needs Linux Chromium (the CI image, or the Linux test host).
