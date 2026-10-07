# The CDP bridge refuses any `Target.*` command its table does not list

Date: 2026-10-07

## Context

agent-browser reaches the in-app browser through the workspace's CDP bridge, which has two endpoints: `page` (a connection pinned to one page) and `task` (the tabs a task holds). Behind both, the main process sends what is left to the guest's own debugger (`dispatch-command.ts`). The table of CDP methods (`packages/workspace/src/lib/cdp-methods.ts`) says what each side does with each command, and a command it does not list passes through.

For the `Target` domain that default is a risk. A guest's debugger can see every Electron target, the Studio window and DevTools included, which is why the bridge answers `Target.getTargets`, `Target.attachToTarget` and the rest itself over the agent's own tabs. The task endpoint already refused a `Target.*` command it did not answer itself. The page endpoint answered only the ones it intercepts and forwarded every other `Target.*` command to the debugger, so a command such as `Target.attachToBrowserTarget`, `Target.exposeDevToolsProtocol` or `Target.sendMessageToTarget` reached a debugger that could name targets beyond the agent's page. No route into the app window through one of them was shown, but nothing stopped one either, and the agent can open a raw connection to the bridge from its own `node`.

## Options

- **Allowlist every domain.** Refuse anything the table does not list, on both endpoints and in main. Rejected: the table is read from agent-browser's source by hand, each agent-browser upgrade can add commands, and a refusal in an ordinary domain (`DOM`, `Page`, `Input`) would break browsing for no security gain. Those domains act on the page the connection already holds.
- **Allowlist only `Target.*` on the page endpoint, matching the task endpoint.** Chosen. The `Target` domain is the only one whose commands can name a different target.
- **Leave it.** Rejected: an unlisted command reaching the app window would hand the agent the Studio renderer.

## Decision

The page endpoint refuses, with `Method not found`, any `Target.*` command the table does not list (`isKnownCdpMethod`). Listed ones keep their entry's handling: the ones the bridge answers itself are still answered, and `Target.detachFromTarget` and `Target.getTargetInfo` still pass through. Every other domain is unchanged: an unlisted command there still passes through, and main still warns once.

Checked against agent-browser's source at v0.38.1 (the pinned version, `CDP_METHODS_READ_FROM`) and at the upstream head of 2026-10-06. Both send exactly these `Target` commands: `activateTarget`, `attachToTarget`, `closeTarget`, `createBrowserContext`, `createTarget`, `detachFromTarget`, `getTargetInfo`, `getTargets`, `setAutoAttach`, `setDiscoverTargets`. Every one is in the table. No method name in its native code is built at run time. The one path that forwards arbitrary commands is `agent-browser inspect`, which proxies the DevTools frontend; the agent-browser shell command already blocks `inspect` (`BLOCKED_SUBCOMMANDS` in `shell-commands/agent-browser.ts`), so nothing that works today is refused.

## Consequences

- **Upgrading agent-browser can break here.** If a later agent-browser sends a `Target.*` command the table does not list, the bridge answers `Method not found` and whatever agent-browser was doing fails, possibly with an unclear error. When an upgrade breaks tab handling, recording, or attaching, grep its source for `"Target.` and compare with the table first. The fix is a table entry, with the bridge answering the command itself if forwarding it could reach another target.
- **Unblocking `inspect`** means deciding what the DevTools frontend's `Target` commands get. It sends ones the table does not list.
- Commands outside the `Target` domain keep the old default, so a new one from agent-browser keeps working and shows up as main's one-time warning.

## Implementation

- [Page endpoint refusal](../../packages/workspace/src/logic/server/routes/cdp-bridge.ts)
- [Table of CDP methods](../../packages/workspace/src/lib/cdp-methods.ts)
- [Tests](../../packages/workspace/src/logic/server/routes/cdp-bridge.test.ts)
