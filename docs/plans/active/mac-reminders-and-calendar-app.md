# Plan: a built-in Reminders and Calendar app on macOS

Status: planned, not started.

## Problem

Tasks reach the Mac's own apps through the `osascript` sandbox command (and always could through `python-native` or `node`), so "remind me" and "put it on my calendar" work today. Model-written AppleScript is the wrong road for the two places users ask for most:

- **Fragile.** A model writes `date "Thursday, October 8, 2026 at 12:00:00 PM"`, which AppleScript parses against the Mac's region settings, so the same script breaks outside a US-format locale. Calendar queries through AppleScript are slow enough to time out across a few calendars.
- **Consent arrives mid-task.** The user's first sight of the capability is a macOS Automation dialog in the middle of a task, and a refusal is only undone in System Settings.
- **Invisible.** Nothing on the Apps screen says Instrument can reach Reminders or Calendar, so the user cannot see the capability, and the conversation offers it only because its prompt says so.

An app gives each of these a better answer: typed tools with ISO 8601 dates, a connect card in our UI before macOS asks, and an entry on the Apps screen.

## Decisions already made

- **First party, not a directory listing.** The strongest existing server, `mcp-server-apple-events` (MIT, EventKit, ~200 stars), ships an ad-hoc-signed Swift binary that launches through a shim using the private `responsibility_spawnattrs_setdisclaim` to make itself responsible for the permission. The system's dialog then asks on behalf of "event" rather than Instrument, and an ad-hoc signature likely ties the grant to one build. Its Swift code is a reasonable starting point; its packaging is not something to put on users' machines.
- **EventKit, not AppleScript.** Reminders and Calendar both have EventKit; it needs neither app open and takes real date values.
- **`osascript` stays** as the road for the long tail: Notes (no EventKit equivalent), Music, Finder, Mail and any other scriptable app. Its description should stop presenting it as the way to do reminders and calendar once this lands.
- **macOS only.** Windows and Linux have no equivalent system store; on those, Outlook and Microsoft To Do arrive as hosted services through the existing app directory.
- **The conversation's rule does not change.** It already asks where a reminder or event lands before starting a task and connects nothing unasked; this app becomes one of the places it offers, connected through the card once picked.

## Work

1. **Swift EventKit CLI.** A universal binary, JSON in and out, built on the macOS release runners and bundled the way `uv` and `ffmpeg` are, signed with the Developer ID in the app's signing pass. No responsibility disclaim, so the request is attributed to Instrument.
2. **Tools.** Reminders: lists, find, create, update, complete, delete. Calendar: calendars, events in a range, create, update, delete. Dates are ISO 8601 with a zone. Recurrence and alarms come later.
3. **Least privilege.** Ask for write-only calendar access (macOS 14+) when the work only adds events, and full access only when it reads them. A denied or restricted status comes back as its own result naming the System Settings switch, never as an empty list.
4. **App entitlements and usage strings.** `com.apple.security.personal-information.calendars` and `com.apple.security.personal-information.reminders` in `apps/studio/build/entitlements.mac.plist` (hardened-runtime keys, beside the Apple Events one, out of the helpers' plist), and `NSCalendarsWriteOnlyAccessUsageDescription`, `NSCalendarsFullAccessUsageDescription` and `NSRemindersFullAccessUsageDescription` in `electron-builder.ts`.
5. **A bundled-binary app kind.** The app system knows hosted MCP and `--local <npm package>`. A built-in app whose manifest points at a binary inside the app bundle is the new piece: listed on the Apps screen on macOS only, connected through the usual card.
6. **Prompt.** The `osascript` description and the orchestrator's list of places name the app for reminders and calendar.

## Verification

- Unit tests for the tool layer's argument and result mapping.
- The `reach-*` evals on GPT-6 Luna and GLM 5.3 Flash: a picked "Mac Reminders" lands through the app's tools rather than `osascript`.
- A packaged beta on a clean Mac: the dialog names Instrument and shows our usage string, the grant survives an update, a refusal comes back as the denied result, and the app launches at all (an entitlement in the wrong plist has produced a build that notarizes and will not launch before).

## Open questions

- Whether the CLI speaks MCP itself (the official Swift SDK) or the workspace wraps a JSON CLI in a small server of its own. The second keeps the tool definitions in TypeScript beside the rest.
- Contacts has its own framework and could join in the same shape; not part of this plan.
