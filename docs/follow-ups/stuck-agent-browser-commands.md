# Why an agent-browser command sometimes never comes back

**Status:** open · **Check after:** 2026-11-21, or once a beta carrying cd075493c has run on the Linux and Windows test hosts for a week, whichever is later · **Last checked:** never

## What we're waiting to learn

On the Linux test host, the first agent-browser command in a chat twice never returned. Both times the tab opened, but the reply stayed held until the app quit, past the debug shell's own 2-minute timeout. So the command was stuck somewhere that timeout's abort does not reach. Both times the app had just been updated and gone through setup. Fifteen later tries on Linux and the Mac, including during and right after setup, all returned in under half a second, so the cause is unknown.

Cd075493c added logging so the next occurrence explains itself (`packages/workspace/src/lib/shell-commands/agent-browser-slow.ts`, `packages/workspace/src/rpc/routes/debug.ts`). Nothing is logged for a command that finishes within a minute.

## The signal

Search the main log for these lines:

| Line | What it means |
| --- | --- |
| `agent-browser <sub> has not finished after 60s: process N is still running` | The CLI itself is hung, waiting on the daemon or the CDP bridge |
| `agent-browser <sub> has not finished after 60s: its process exited Ns ago and its output is still open` | The CLI finished, but a process it left behind holds its output pipe, the hang Windows already works around in `spawnAgentBrowser` |
| `agent-browser <sub> finished after Ns` | The same command came back late rather than never |
| `Debug shell command still running Ns after its Ns timeout` | The debug route's abort did not end the command |

A hang that someone saw but that left none of these lines means the command finished and its reply got lost between main and the window. That is the reply path, which this logging does not cover.

## Where to look

- The main log of the installed app on each test host (`logs/main.log` in its user data folder) for any build at or after cd075493c.
- A beta tester's own report or log, if one mentions a browser step that never finished.
- On Linux, also note whether the app had just been updated or gone through setup when the line appeared, since both earlier hangs had.

## What each answer means

- **Still running:** capture the CLI's and daemon's stacks on the next occurrence (`/proc/<pid>/wchan` and the daemon's open descriptors on Linux). Then decide whether the CDP bridge needs its own timeout.
- **Output still open:** use the Windows path (wait on the process exit, read the output from files) on every platform, and close this.
- **Debug route overdue, no agent-browser line:** the hang is in the shell, not the browser. Move this to a finding about the just-bash abort.
- **Nothing logged after the check date, no hang seen:** close it as not recurring. Keep the logging, since it costs nothing while quiet.

## Related

- The agent-browser daemon on Linux starts with about 98 descriptors inherited from the app's main process, including its storage files and shared memory, and outlives the app. It does not hold the command's output pipe, so it is not thought to cause this. Worth a finding of its own if the "output still open" line ever appears.

## Result

_Filled in when closed: what the log showed, on which platforms, how often, and the commit that fixed or closed it._
