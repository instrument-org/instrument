# agent-browser `download` never restores the browser's download behavior

**Status:** open. A skill caveat steers the agent around it; the upstream fix is written but unpublished and needs an explicit go-ahead to file.

## Issue

Upstream agent-browser's `download` command sends
`Browser.setDownloadBehavior` with `allowAndName` and the destination
directory before clicking, and never undoes it (`handle_download` in
`cli/src/native/actions.rs`; verified at v0.32.3). On the Instrument task
browser this is harmless. On a connected external browser (`--auto-connect`
or `--cdp` against the user's own Chrome), every later download in that
browser, including ones the user triggers themselves, lands in the last
`download` command's directory under a GUID filename until the browser
restarts.

## Mitigations in place

- The `agent-browser` skill's External browsers section tells the agent to
  avoid `download` in the user's own browser and prefer the task browser or
  a page-level fetch for file downloads.

## Proper fix (written, unpublished)

Add `BrowserManager::restore_download_behavior` -- re-send
`Browser.setDownloadBehavior` with the launch-configured download directory
when one exists, otherwise the browser default -- and call it on every exit
path of `handle_download`. Written against the upstream source, but
compile-unverified (no local Rust toolchain); upstream CI would cover it.
Publishing it as a PR needs an explicit go-ahead. Once it ships upstream,
bump the pinned `agent-browser` version and drop the skill caveat.
