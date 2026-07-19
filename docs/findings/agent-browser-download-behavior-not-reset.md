# agent-browser `download` never restores the browser's download behavior

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

A patch exists on the `fix/restore-download-behavior` branch of the local
upstream checkout (`reference/agent-browser` sibling repo): adds
`BrowserManager::restore_download_behavior` (launch-configured directory
when one exists, otherwise browser default) and calls it on every exit path
of `handle_download`. Compile-unverified locally (no Rust toolchain);
upstream CI would cover it. Publishing (fork + PR to vercel-labs) needs an
explicit go-ahead. Once it ships upstream, bump the pinned `agent-browser`
version and drop the skill caveat.
