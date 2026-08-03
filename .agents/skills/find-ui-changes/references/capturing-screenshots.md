# Capturing Screenshots Of A Surface

How to drive the running Studio app and produce one cropped image per surface in the queue.

Read `.agents/skills/studio-chrome-devtools/SKILL.md` for the general picture. This file covers only what is specific to screenshotting review surfaces.

## Drive it with studio-drive.mjs

```bash
DRIVE=".agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs"

node $DRIVE boot                                     # your own instance, on its own port
node $DRIVE goto /skills
node $DRIVE click --text "New skill"
node $DRIVE shot shots/skills.png --selector '[role=dialog]' --pad 8
node $DRIVE stop
```

`boot` starts an instance this run owns rather than attaching to whatever is on the conventional port, which is usually a window a person is working in. Boot from the same checkout the range came from, and confirm nothing landed after your range that touches these surfaces: a worktree on a feature branch will show UI that is not in the queue.

`goto` and `state` go through the renderer's dev-only drive handle, so a surface is one call away instead of a click chain, and `state` tells you where you actually are. `click` matches on accessible name and dispatches real input. `shot --selector` crops browser-side at native resolution.

## Choosing the frame

A full-window shot is right when the surface is about framing or layout. A cropped element is right for everything else — pass `--selector` or `--text`. Trim panels to the region that carries the change: a viewer body that is 60% empty reads as a bug in the screenshot rather than as a viewer.

Check the reported `dimensions`. A crop that silently did not apply comes back at full-window size.

Pick a task that already holds the files or state a surface needs rather than driving the agent to produce them. For states with no ordinary path — the post-update toast, the running-agent quit prompt — see the dev panel entries listed in the studio-chrome-devtools skill.

## Attaching to Notion

The Notion MCP integration takes an attachment as inline UTF-8 text, a publicly reachable HTTPS URL, or a file id from an upload it made itself. There is no binary path for a local PNG, and inlining a base64 image as text costs more output tokens than a message can hold. So a local screenshot has to become a public URL first.

The working route is a two step: upload each PNG to a host that returns a direct link, pass that link to `create-attachment` as `source_url`, then embed the returned `file-upload://` source with `update-page`. Notion copies the bytes, so the page keeps working if the host does not.

```bash
curl -sS -F "reqtype=fileupload" -F "fileToUpload=@shot.png" https://catbox.moe/user/api.php
```

Notion needs a direct link: no redirect, no cookies or headers, not a private address. Paste hosts that shut off anonymous uploads or return an HTML landing page will not work.

Get the user's approval for the specific batch before uploading, and name the host you intend to use. Approval given for one set of screenshots does not carry to the next: a capture can pick up a real task title, a real filename, or a surface that has not shipped, and only the user can judge that.
