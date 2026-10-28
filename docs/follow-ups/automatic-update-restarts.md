# How often the app restarts itself to install an update, and whether anyone notices

**Status:** open · **Check after:** two releases shipped to a beta that restarts on its own, and at least a week of use · **Last checked:** never

## What we're waiting to learn

The app restarts itself to install a staged update when no one is using it ([auto-updater.md](../architecture/auto-updater.md#restarting-while-the-app-is-not-in-use)). Every timing in `IDLE_RESTART` (`idle-restart-policy.ts`) is a starting value: 10 quiet minutes, 10 minutes away for an unseen restart, a day before and between restarts in view, two attempts per update. We want to know whether updates actually land this way, which blockers hold them back, whether the seen restart ever fires, and whether an attempt ever fails.

## The signal

Main-process log lines scoped `idleRestart`, each written once per change:

- `waiting: <blocker>`: what held the restart back. `work-unknown` appearing often means the agent count fails, which keeps updates from landing.
- `restart (unseen)` / `restart (seen)` followed by `Restarting to install <version> (<tier>)`: a restart that went.
- `Called off the restart: <blocker>`: the last look found the app in use, the race the final re-check exists for.
- `The restart did not go ahead: <outcome>`: the install path declined after deciding to restart.
- `waiting: attempts-used`: two attempts at one update came back on the old version.

On the launch that follows, `Back from an automatic restart, window <view>` from the main scope.

None of them in a week of use on macOS or Windows means the restart never became eligible: read which `waiting:` line is last.

## Where to look

The main-process logs of the beta machines that ran the build, macOS and Windows, across at least two releases.

## What each answer means

- **Unseen restarts land and no one noticed:** keep the values; consider shortening the 10 quiet minutes.
- **`attempts-used` on a platform:** an install path that fails unattended; read that launch's updater lines and open a finding.
- **`work-unknown` dominates:** the agent count fails outside a quit; fix the count rather than loosen the rule.
- **A seen restart that someone took for a crash:** raise `seenAfterWaitingMs`, or drop the seen tier.
- **`Called off the restart` shows up:** the race is real; check what started, and whether the fade window needs its own re-check.

## Result

Not yet checked.
