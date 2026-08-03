# Capturing Screenshots Of A Surface

How to drive the running Studio app and produce one cropped image per surface in the queue.

Read `.agents/skills/studio-chrome-devtools/SKILL.md` first for connection details. This file covers only what is specific to screenshotting review surfaces.

## Connect

Studio must already be running with a debug port. If it is not, boot it from `apps/studio`:

```bash
REMOTE_DEBUGGING_PORT=48160 pnpm dev
```

Unset `ELECTRON_RUN_AS_NODE` first or Electron starts as Node and exits without a window.

```bash
export CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1
pnpm exec chrome-devtools start --browserUrl http://127.0.0.1:48160
pnpm exec chrome-devtools list_pages --output-format=json
```

Boot Studio from the same checkout the range came from, and confirm nothing after your range touched these surfaces. A worktree running a feature branch will show UI that is not in the queue.

## Drive the app

Use `take_snapshot` to get element uids, then `click <uid>`. Those dispatch real CDP input.

`element.click()` from `evaluate_script` works on plain buttons but silently does nothing on cards and other composite rows whose handler sits on an ancestor. If a click appears to succeed and the UI does not change, that is the cause.

Two traps when picking a control:

- **Do not guess a toolbar button by its index in the snapshot.** Unlabeled icon buttons appear as bare `button` entries, and off-by-one lands on the close button. Map them by geometry instead, then click the one at the expected position:

  ```bash
  pnpm exec chrome-devtools evaluate_script "function() {
    const out = [];
    document.querySelectorAll('button').forEach((b) => {
      const r = b.getBoundingClientRect();
      if (r.width === 0) return;
      out.push({ x: Math.round(r.x), y: Math.round(r.y), label: (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 20) });
    });
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
  }"
  ```

- **Filter to visible elements when matching by text.** Filenames and labels often appear two or more times in the DOM, and the hidden copy has a zero rect. Require `getBoundingClientRect().width > 0`.

## Reaching a surface

The renderer does not put the current route in the URL, and Studio restores its persisted tab session on load. So:

- `location.hash` is not the route. Check `document.title` or on-screen content to confirm where you are.
- Navigating the renderer to a route URL does not open that route. It loads, then the app restores the previous tabs over it.
- Reach routes the way a user does: click the task in the sidebar, use the task header's Files tab, or open Settings. In developer mode the dev badge has a Pages menu that opens routes in a new tab.
- Release notes: Settings, then General, then Release notes.

Pick a task that already contains the files or state the surface needs rather than driving the agent to produce them.

## Screenshot and crop

`take_screenshot` writes **device pixels**; `getBoundingClientRect()` returns **CSS pixels**. Measure the element, then crop with `devicePixelRatio`. Never convert by eye.

```bash
pnpm exec chrome-devtools take_screenshot --filePath /tmp/full.png
pnpm exec chrome-devtools evaluate_script "function() {
  const r = document.querySelector('SELECTOR').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: window.devicePixelRatio };
}"
```

Crop with any image library; multiply each value by `dpr`.

A full-viewport shot is right for a surface that is about framing or layout. A cropped panel is right for everything else. Trim tall panels to the region that carries the change: a viewer body that is 60% empty reads as a bug in the screenshot.

`--uid` takes an element screenshot directly, which is simpler when the target is a single labelled element.

## Two failure modes that waste time

- **Black frames.** If the window is occluded or the app is mid-reload, the capture is a uniform dark rectangle and repeated captures are byte-identical. Check the file size against a known-good shot before trusting a frame.
- **Dev-server reloads.** Any commit or file change in the checkout triggers an HMR sweep that resets the app to its start route mid-run. If a step suddenly acts as though nothing is open, re-navigate and retry rather than debugging the click.

## Attaching to Notion

The Notion MCP integration takes an attachment as inline UTF-8 text, a publicly reachable HTTPS URL, or a file id from an upload it made itself. There is no binary path for a local PNG, and inlining a base64 image as text costs more output tokens than a message can hold. So a local screenshot has to become a public URL first.

The working route is a two step: upload each PNG to a host that returns a direct link, pass that link to `create-attachment` as `source_url`, then embed the returned `file-upload://` source with `update-page`. Notion copies the bytes, so the page keeps working if the host does not.

```bash
curl -sS -F "reqtype=fileupload" -F "fileToUpload=@shot.png" https://catbox.moe/user/api.php
```

Notion needs a direct link: no redirect, no cookies or headers, not a private address. Paste hosts that shut off anonymous uploads or return an HTML landing page will not work.

Get the user's approval for the specific batch before uploading, and name the host you intend to use. Approval given for one set of screenshots does not carry to the next: a capture can pick up a real task title, a real filename, or a surface that has not shipped, and only the user can judge that.
