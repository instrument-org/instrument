# What a phone's content blockers hide of the window served to it

**Status:** open · **Check after:** the phone page has a layout of its own for a phone's width · **Last checked:** 2026-11-01, one phone, blockers then turned off for the host's address

## What we're waiting to learn

The window's own renderer served to a phone (`apps/studio/src/electron-main/phone-host/`, `apps/studio/src/phone.html`) runs inside the phone's Safari, where a content blocker applies a stylesheet the page cannot read and an inline `display: flex !important` cannot outrank. On the first phone it ran on, one such rule hid the window's root by its test id (`[data-testid="app-page"]`) and the page showed nothing. We want to know which elements the common blockers hide, so the page avoids the names they match or the shell that ships carries its own web view, where no blocker runs.

## The signal

The phone page's `status` report, twenty seconds after it loads, in the dev log under the `phone-host` scope: `root <w>x<h>, <n> elements, text: ...`. A window that laid out reads several hundred elements and the chat list's words; one a blocker hid reads a few hundred elements and no words, or `App zoom 100%` alone.

## Where to look

The dev log of the instance serving the phone, with a phone whose content blockers are on, and the page reloaded with them off for comparison (long-press Safari's reload, "Reload Without Content Blockers").

## What each answer means

- **Only the test id is hit:** leave that attribute off the phone page, or rename it, and move on.
- **Class names the renderer uses are hit:** a web page in Safari is the wrong shell for the phone; the Capacitor web view, which runs no blocker, becomes the plan rather than an option.
- **Nothing is hit with the common blockers:** the page can stay a page.
