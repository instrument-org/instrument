# Pages that keep playing after their tab steps away

**Status:** open · **Check after:** 2026-12-03, after a week or more on a beta that closes put-away pages for their sound · **Last checked:** never

## What we're waiting to learn

Whether any page still plays out of sight once main closes the pages a tab has stepped away from. A tab keeps the page it left as a step of its history, its guest parked and still running, so a page with video went on playing with nothing on screen to stop it until the person closed the tab. The commit that adds `apps/studio/src/electron-main/browser-view/put-away-sound.ts` closes such a page as soon as it makes sound, logs each close, and checks 10 seconds later that it stopped. The same complaint has come back three times on different paths (our own players, a page hosted in Files, a tab's history), so the question is also whether sound reaches anyone from a path this rule does not cover.

## The signal

Two lines in the main log, scope `BrowserViewManager`:

- `Closed a page a tab stepped away from, as it was playing sound (<site>)`: info, one per close. Shows how often the rule acts and on which sites.
- `Stray sound: a page a tab stepped away from still plays 10s after it was closed (<site>)`: a warning through the alarm gate every such warning shares (`packages/shared/src/alarms.ts`), at most once an hour. The close did not take.

A launch with neither line had no put-away page make sound.

## Where to look

The installed app's main log on the primary Mac and on the test hosts, and problem reports, which carry the main log's last lines. A report saying sound plays with nothing on screen is the other signal, since the alarm covers only pages a tab holds as a step of its history.

## What each answer means

- **`Stray sound` appears:** the close does not stop the page. Read what the log says about that tab around the line (its window, a hand-off between windows, a crash) and reproduce it with a page that loops a tone.
- **Closes appear and nobody reports sound:** the rule works. Note how often it acts; if it is often on sites people return to, a step back that reloads may be worth a softer stop.
- **A report of stray sound with no line:** sound came from a path the rule does not watch, such as a page no tab holds or the app's own players. Find the path before adding another rule.
- **No lines and no reports:** close this as quiet.

## Result

Not checked yet.
