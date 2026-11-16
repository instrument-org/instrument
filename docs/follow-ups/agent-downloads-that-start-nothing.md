# Why an agent's download command starts no download

**Status:** open · **Check after:** 2026-11-30, or once a build carrying the `download for=` log lines has run a week of real browser chats on Windows and macOS · **Last checked:** never

## What we're waiting to learn

On a file host whose Download button leads to a countdown page that starts the file a few seconds later, `agent-browser download <ref>` failed twice in one chat while the same page downloaded fine for the person. The agent's authorization (`Browser.setDownloadBehavior`) then stayed on the tab and claimed the person's next click, saving it under a GUID in the agent's folder where nobody saw it. The commit that adds this follow-up makes a person's input after the authorization take the next download back, and logs every download the browser session sees, since the app log had no download lines at all and nothing said why the agent's command failed.

## The signal

Main log lines from the browser view:

- `download for=<agent|person|asked|retry> targetId=<id> committed=<bool> host=<host>[ via=<host>]` when a download starts and is routed.
- `download refused from=<role> host=<host>` for one from a contents no tab owns (a popup window, say), which is canceled.
- `download refused local file targetId=<id>`.
- `download <completed|cancelled|interrupted> received=<n> total=<n> host=<host>` when it ends.

| What shows | What it means |
| --- | --- |
| No `download` line during the agent's failed command | The click never started a download in the session: the page waited for something the agent's click does not give it (a countdown it never sat through, a check of the input) |
| `download refused from=popup` during it | The page opened the file in a popup window, which no tab owns |
| `download for=person` during it | The download started, but in a tab other than the one the agent authorized, such as a tab the page opened |
| `download for=agent` then `cancelled` or `interrupted` | The download started for the agent and the transfer itself failed |
| Agent downloads all `for=agent` and `completed` | The failure is not recurring; close |

## Where to look

- The main log in a problem report from a chat where the agent's `download` errored or timed out, matched by time to the call in the chat's records.
- A beta tester's report of a download button that does nothing in the in-app browser.

## What each answer means

- No download line: the command's click is not enough for the page; teach the browser skill to wait on the page or click through, and leave the routing alone.
- A popup's download refused: send a popup's download to the tab that opened it rather than canceling it.
- Started in another tab: route a download from a tab a page opened to the opener's authorization while the agent's command waits.
- The transfer failing: look at the host's response to the agent's request.

## Result

Not yet checked.
