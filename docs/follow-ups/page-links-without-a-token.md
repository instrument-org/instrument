# Whether page links without a link token can stop opening

**Status:** open · **Check after:** 2026-12-13, 30 days after the pages worker began giving every new page a link token, plus a day for its bucket's lifecycle rule · **Last checked:** never

## What we're waiting to learn

Every page published since 2026-11-11 has a random link token as the first segment of its path, `https://<id>.instrument.page/<token>/`, and its Open in Instrument hands the app `instrument://page/<id>/<token>`. A page published before that has no token, so `outsideLinkOf` still reads `instrument://page/<id>` alone, and `fetchHostedPage` still fetches the bare host for it. Pages expire 30 days after they are published and are never rewritten, so after the check date no page without a token is left to open. The pages worker drops its own tokenless path on the same date. The question is whether that holds, so the app can stop reading a link without a token.

The commit that adds this note is the one that taught the app to read the token.

## The signal

- Main-process lines scoped `outside-link` that say a page's host `answered 404` for a link with no token. Once no tokenless page is left, any such link that arrives names an expired page.
- The pages worker's own follow-up on retiring its tokenless path, which counts what is left in its bucket. Closed there means none are left here either.

## Where to look

The main-process logs of beta machines that opened pages from links. The pages worker's follow-up, in the repository that holds the worker.

## What each answer means

- **No tokenless pages left:** remove the tokenless case. In `packages/shared/src/instrument-link.ts`, `pageOf` requires the token segment and `OutsideLink`'s `token` stops being optional. In `apps/studio/src/electron-main/lib/hosted-page.ts`, `hostedPageUrl` and `fetchHostedPage` take the token as required. Then drop the tokenless cases from their tests, and the sentence on pages from before link tokens in `docs/architecture/deep-links.md`.
- **Some left:** wait for them to expire, and move the date.

## Result

Not yet checked.
