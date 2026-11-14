# A sleeping Mac answers in dark wakes, late and with no promise

**Status:** working as the platform designs it, researched and observed 2026-11-12. A Mac asleep with its lid closed runs the app for a few seconds in each maintenance dark wake, so a phone's draft can be sent and answered while it sleeps, minutes late. Nothing an app can call stretches a dark wake on battery, and Windows and Linux run nothing while asleep. We take requests in dark wakes, say a reply may be slow, report the dark wake in `status.json`, and build no keep-awake feature for now.

## What we saw

A laptop with its lid closed took drafts sent from the phone during maintenance dark wakes and answered them minutes late: a turn would start in one wake, stop when the system went back to sleep, and carry on in a later one, one of them about twelve minutes on. Nothing failed; the reply was just slow, and nothing on the phone said why.

## What we chose

- A computer takes a phone's request whenever it is running, dark wakes included, and the phone tells the person a reply from a sleeping computer may be slow. Turning requests away in a dark wake would trade a late answer for none.
- Each computer writes `.instrument/devices/<device>/status.json` (`records/device-status-file.ts`, [chat records](../architecture/chat-records.md)): awake, asleep or closed, and `darkWake` on macOS, read from `ioreg` as described below, so the phone can show which computers are asleep and which one is answering from a dark wake.
- No keep-awake feature for now. The assertion an Electron app can hold blocks idle sleep only and does nothing in a dark wake or against a closed lid on battery (below), so it would not have changed what we saw.

## What dark wake and Power Nap are

Apple's IOKit headers describe dark wake as the "CPU and core hardware running in 'Dark Wake' state, instead of sleeping" ([IOPM.h](https://github.com/apple-oss-distributions/xnu/blob/main/iokit/IOKit/pwr_mgt/IOPM.h)). The system capability flags are CPU 0x1, Graphics 0x2, Audio 0x4, Network 0x8; dark wake is CPU plus Network without Graphics (same header, `kIOPMSystemCapability*`).

The triggers seen in practice are timed `rtc/Maintenance` and `rtc/SleepService` wakes requested by `dasd` and `mDNSResponder`, plus network wakes, logged as `DarkWake ... due to EC.RTC/Maintenance Using BATT ... 6 secs`. People report one about every 15 minutes, lasting about 5 seconds ([Apple Community](https://discussions.apple.com/thread/256069466)), which matches what we saw.

Power Nap, per Apple, "lets Mac computers stay up to date even while they're sleeping": on battery it checks Mail and updates Calendar and iCloud, and on power it adds software updates and Time Machine ([Apple Support](https://support.apple.com/guide/mac-help/turn-power-nap-on-or-off-mh40774/26/mac/26)). The setting is "only available on Intel-based Mac computers" (same page). That it is always on for Apple silicon comes from third-party write-ups, not Apple, and Apple gives no interval or duration.

Other processes do run, as a side effect. Apple's developer technical support calls dark wake "an internal mechanism that shouldn't really be visible to the larger system", which "definitely 'leaks' into the larger system (with the most obvious example being the fact your app is awake)", and says "we don't have any API for detecting DarkWake" ([Apple Developer Forums 770517](https://developer.apple.com/forums/thread/770517)). A backup service documents that Power Nap is reserved for Apple's own features and not available to its app. Read together: the CPU and network are up, everything not frozen runs, and nobody promises a process enough of it to finish anything.

## Telling a dark wake from a full wake

- There is no public API ([Forums 770517](https://developer.apple.com/forums/thread/770517)). Apple suggests reading IOPMrootDomain's properties, `IOServiceAddInterestNotification` and the assertion lists, "not guaranteeing anything will work" (same thread).
- `kIOMessageSystemHasPoweredOn` is not delivered in a dark wake "because Dark Wake isn't considered 'On'", and `NSWorkspaceDidWakeNotification` "basically means exactly" a full wake (same thread).
- The practical probe: "System Capabilities" in `ioreg -r -n IOPMrootDomain` reads 9 in a dark wake and 15 at a full wake, and stays 15 while only the display sleeps, as one open-source project measured on one Mac. Another found `CGDisplayIsAsleep` gave false positives. `status.json` reads the graphics bit (0x2): absent is a dark wake.
- Electron's `powerMonitor` emits `resume` from Chromium's `kIOMessageSystemWillPowerOn` and `suspend` from `kIOMessageSystemWillSleep` ([Chromium](https://chromium.googlesource.com/chromium/src/+/main/base/power_monitor/power_monitor_device_source_mac.mm), [Electron](https://github.com/electron/electron/blob/main/shell/browser/api/electron_api_power_monitor.cc)). WillPowerOn comes before any wake, so `resume` probably fires on dark wakes too (inferred, not verified). The events are known to arrive twice ([#24803](https://github.com/electron/electron/issues/24803)) or not at all ([#42050](https://github.com/electron/electron/issues/42050)), which is why `status.json` also has a heartbeat.

## Making work finish

- `PreventUserIdleSystemSleep` (Electron's `powerSaveBlocker('prevent-app-suspension')`, `caffeinate -i`, and the keep-awake setting other desktop agents offer) blocks idle sleep only and "has no effect if the system is in Dark Wake" ([IOPMLib.h](https://github.com/apple-oss-distributions/IOKitUser/blob/main/pwr_mgt.subproj/IOPMLib.h)). Chromium maps `prevent-app-suspension` to `kIOPMAssertionTypeNoIdleSleep`, the same assertion ([Chromium](https://chromium.googlesource.com/chromium/src/+/main/services/device/wake_lock/power_save_blocker/power_save_blocker_mac.cc), [Electron docs](https://www.electronjs.org/docs/latest/api/power-save-blocker)), so an Electron blocker held during a dark wake does not stretch it.
- `PreventSystemSleep` (`caffeinate -s`) is "valid only when system is running on AC power" ([caffeinate(8)](https://github.com/apple-oss-distributions/PowerManagement/blob/main/caffeinate/caffeinate.8)). powerd reportedly treats it as the only assertion that can hold a dark wake, and on power a lid close then logs `Entering DarkWake state due to 'Clamshell Sleep'`. The public header marks it "Deprecated in 10.9 ... Do not use it" ([IOPMLib.h](https://github.com/apple-oss-distributions/IOKitUser/blob/main/pwr_mgt.subproj/IOPMLib.h)), yet `caffeinate` still ships it, and reports on Apple silicon are mixed.
- `NetworkClientActive` "keeps the system awake in dark or full wake, as long as the system is on AC power", and is "a suggestion" (same header). `ApplePushServiceTask` is private and not in the header.
- Closing the lid on battery is "forced sleep", and "it is not possible to prevent forced sleep, only delay it" ([QA1340](https://developer.apple.com/library/archive/qa/qa1340/_index.html)). Only `sudo pmset disablesleep 1` (global, needs root) or clamshell mode on power with an external display gets past it.
- Scheduling a wake with `IOPMSchedulePowerEvent` "Must be called as root" ([IOPMLib.h](https://github.com/apple-oss-distributions/IOKitUser/blob/main/pwr_mgt.subproj/IOPMLib.h)), so apps that do it ship a root helper through `SMAppService.daemon` or a narrow sudoers rule for `pmset schedule`. Apple's softer route is an XPC Activity with `REQUIRE_SCREEN_SLEEP` and `PRIORITY_MAINTENANCE`, which "would roughly match up with Dark Wake" ([Forums 770517](https://developer.apple.com/forums/thread/770517)).

## Windows and Linux

Windows Modern Standby stays in S0, but "Desktop apps are stopped by the Desktop Activity Moderator (DAM)", and only Store app background tasks run ([Microsoft Learn](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/modern-standby-vs-s3)); "Windows prevents desktop applications from running during any part of modern standby" ([Prepare software for modern standby](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/prepare-software-for-modern-standby)). An Electron app gets nothing like a dark wake there. The only lever is `SetThreadExecutionState` before the computer sleeps.

Linux's s2idle and deep sleep both freeze all of user space until resume ([kernel docs](https://docs.kernel.org/admin-guide/pm/sleep-states.html), [suspend flows](https://www.kernel.org/doc/html/v6.0/admin-guide/pm/suspend-flows.html)). Nothing runs while asleep.

## What other products do

- Another desktop agent offers a keep-awake setting that stops idle sleep and says closing a laptop's lid still puts it to sleep.
- A coding agent's CLI has an experimental idle-sleep blocker, off by default.
- A backup service asks for the power adapter connected and the lid left open.
- Remote desktop hosts are unreachable with the lid closed unless a monitor is attached or sleep is disabled.
- Keep-awake utilities need a sudoers helper for closed-lid use on Apple silicon, and several paid apps sell exactly that.

We found no product that documents relying on dark wakes. Every one recommends keeping the Mac awake, plugged in, with the lid open or in clamshell mode with an external display.

## What might change this

- If people need replies from a closed laptop on time, the candidate to test is holding `caffeinate -s -w <pid>` for the length of a turn while on power, which may keep a closed Mac in a dark wake. On battery nothing an app can call will.
- Turns should stay safe to stop at any point and to carry on in a later wake, since a dark wake can end one mid-request.
- What to tell the person stays plain: a Mac answers fastest when it is awake, and while it sleeps a reply may arrive late or wait until it is opened. On Windows and Linux nothing runs while the computer sleeps.
