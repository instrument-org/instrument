# How often the app restarts itself to install an update, and whether anyone notices

**Status:** closed as answered: automatic installs reached their requested builds on all three computers · **Last checked:** 2026-11-08

## What we're waiting to learn

The app restarts itself to install a staged update once the person steps away ([auto-updater.md](../architecture/auto-updater.md#restarting-while-the-app-is-not-in-use)). Every timing in `IDLE_RESTART` (`idle-restart-policy.ts`) is a starting value: a minute locked, 5 minutes with no window showing, 15 minutes without input, a 3-day backstop after 10 quiet minutes, an hour between restarts, two attempts per update. We want to know whether updates land this way, which sign of stepping away does it, which blockers hold restarts back, whether the backstop ever fires, and whether an attempt ever fails.

## The signal

Main-process log lines scoped `idleRestart`, each written once per change:

- `waiting: <blocker>`: what held the restart back. `in-use` means nothing was in the way and the person had not stepped away. `work-unknown` appearing often means a check fails or times out, which keeps updates from landing.
- `restart (<reason>)` followed by `Restarting to install <version> (<reason>)`: a restart that went, by `locked`, `no-window`, `away` or `backstop`.
- `Called off the restart: <blocker>`: the last look found the app in use, the race the final re-check exists for.
- `The restart did not go ahead: <outcome>`: the install path declined after deciding to restart.
- `waiting: attempts-used`: two attempts at one update came back on the old version. The bell says so too.

On the launch that follows, `Back from an automatic restart, window <view>` from the main scope.

None of them in a week of use on macOS or Windows means the restart never became eligible: read which `waiting:` line is last.

## Where to look

The main-process logs of the beta machines that ran the build, macOS and Windows, across at least two releases.

## What each answer means

- **Restarts land by `locked`, `no-window` or `away` and no one noticed:** keep the values.
- **Only `backstop` restarts:** the signs of stepping away are too strict for how people work; shorten them.
- **`attempts-used` on a platform:** an install path that fails unattended; read that launch's updater lines and open a finding.
- **`work-unknown` dominates:** a check fails outside a quit; fix the check rather than loosen the rule.
- **A backstop restart someone took for a crash:** lengthen `backstopAfterMs`.
- **`Called off the restart` shows up:** the race is real; check what started, and whether the fade window needs its own re-check.

## Result

Checked 2026-11-08 in the installed apps' retained main logs, covering automatic restarts from October 29 through November 8:

- **Primary Mac:** 20 restarts, 7 while locked and 13 while away. All 20 have a return marker and a subsequent updater line on the requested build, through beta.135.
- **Windows test host:** 16 restarts, 10 while locked, 4 while away and 2 with no window. All 16 returned on the requested build, through beta.134. One same-version beta.113 restart completed the recorded NSIS-to-Velopack migration successfully; it was not a failed update loop.
- **Laptop:** 11 restarts, 8 while locked and 3 while away. All 11 reached the requested build, through beta.134; the installed app is now beta.135. Nine have a return marker. The other two reached beta.128 and beta.130 about 16.5 and 17.8 minutes after the restart request, during periods with dark-wake activity; those two delays are not evidence of prompt unattended installation.

No machine logged a backstop restart, exhausted attempts, an unknown-work blocker, a called-off restart or a declined restart outcome. Waiting-state counts are transitions, not time spent blocked. Keep the timing values: ordinary locked, away and no-window restarts are installing updates without needing the backstop. The logs establish successful installs, not whether a person noticed them; no subjective feedback was collected.
