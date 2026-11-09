# Browser start pages

Status: done. Implemented history-derived hostname limits, frequent destinations, and start-page metadata with focused store tests and running-app validation.

## Behavior

The browser start shows bookmarks, up to six frequently visited sites, and up to twelve recent pages. Recent pages stay newest first with at most two pages per hostname, folding the `www.` prefix while preserving other subdomains. Exact bookmarked destinations are excluded from both generated sections. Recent history and address completions keep their existing behavior outside this start page.

Frequently visited sites come from visible human visits in the preceding thirty days, with visits on at least two local calendar days. Rank sites by distinct visiting days, then days with explicit opens, then latest visit, with a deterministic URL tie-breaker. Choose each site's destination by the same ordering over its pages. Keep deep links intact. Agent visits, hidden visits, and future timestamps do not contribute. No logging, persisted ranking, or schema migration is added. Removing a frequent site from its context menu hides its host from this section alone (`frequent_hidden` in `history.db`), with Undo; its visits stay in history and Recent pages, and clearing history from the hide's time on brings it back.

Recent entries show their hostname and relative visit time. The bookmark invitation is the same full panel with or without history. Sparse history leaves generated sections short or absent.

## Validation

The focused store tests cover hostname flooding and backfill, hostname normalization, exclusions, repeat-day ranking and destination choice, time boundaries, clearing, and metadata. Running-app checks cover empty history, a populated start page, opening a frequent deep link, bookmark exclusion and restoration, light and dark themes, narrow layouts, and UI zoom. Types and lint are checked for Studio. The start-page subscription re-reads on history changes, bookmark changes, and returning to the tab; it does not poll as an idle page crosses the rolling window boundary.
