# A script drives the browser through the shell's own command

Date: 2026-11-23

Adds the browser to the script channel of [2026-10-27-scripts-reach-instrument.md](2026-10-27-scripts-reach-instrument.md). The inventory row it changes is in [plans/one-capability-layer.md](../plans/one-capability-layer.md).

## Context

A script reached apps, memories, the window's reads, the web and images through `instrument`, and not the browser, which was the shell's `agent-browser` command alone. Two real sessions on a GPT model wrote a script to go through a site's pages, one in Python with `subprocess.run(["agent-browser", "eval", js])` and one in Node with `execFileSync("agent-browser", ...)`. Each was told there was no such program and gave up on scripting: one ran a browser command per model step from then on, the other moved its loop into the page as an iframe script and ran into the limit on how long one `eval` may take. Both scripts had the same shape, a small helper taking the command's words and returning what it printed.

## Options weighed

**A real `agent-browser` program on a script's PATH that routes back to the app.** Rejected: it would have to find the channel, and the channel's variable and token are taken out before the script's code runs so that no process the script starts can reach the person's signed-in browser. That stays. The program on the PATH is a stub that says how the script calls the browser itself and exits 127.

**A typed page API (`page.click(ref)`, `page.rows()`).** Rejected: the agent already knows the command line, from the guide its first command brings, and both real scripts were written against it. A second vocabulary is one more thing to learn and to keep in step with a CLI that changes with every release.

**A capability with its own implementation of the command's rules.** Rejected: the flag policy, the folder rules for file operands, the tabs and the session a command drives them as, the tab ids and the follow-up all live in the shell's command. A second copy would drift, and a drift here is a way around the policy.

**Keep the script's commands out of the model's follow-up.** Rejected: a script that leaves the page changed is the same to the next step as a typed command that did, and a model that does not see the page after a loop spends a step asking for it.

## Decision

- `instrument.browser(...)` in Node and Python takes the words of the command line, as arguments or as one list, and returns what the command printed on stdout: `instrument.browser("eval", js)`, `instrument.browser(["open", url])`. What the command reads on stdin is `stdin=` in Python and a last `{ stdin }` object in Node. A command that fails raises or rejects with `instrument.Error` carrying its exit code, stderr and stdout (`exit_code` in Python, `exitCode` in Node), its message the command's own.
- It is one capability, `browser.run`, on the script surface only. It has no gate of its own: its work is to run `agent-browser` as one command in a shell built from the bash call's own options (`browserThrough` in `capabilities/browser.ts`), the script's words as that command's argv, never parsed as shell text. In the bash worker that shell is the one on the main thread the worker's own `agent-browser` already comes back to; with the interpreter on the main thread it is a second shell of the same options, built at the first call. Either way the shell's command is the only code that runs, so whatever it refuses when typed it refuses from a script, in the same words.
- The command runs from the folder and with the environment of the `node` or `python` command that started the script, which the channel takes from that command and the script never names. A relative path the command names resolves there, whatever the script has since changed its own folder to.
- A script gets the command's own output and nothing added to it. What the shell's command adds for the model waits for the end of the bash call, once: the page as the call left it (`Page after`), the last screenshot, a failed command the output does not show, the guide when this is the session's first browser command, and the lines that would have ended a command's output (who else used the tab, a popup the page opened), which the bash result carries as `browserNews`.
- The stub a program gets when it starts `agent-browser` names the call, with a line to copy in each language, and the loop in the shell. With the script surface closed (the evals' bash-only arm) it names the shell alone.

## What it costs

- Each call is a command: the CLI starts, the wrapper reads the page's messages before an action, and the session's hosts are recorded, as for a typed one. A script that makes a hundred calls pays that a hundred times, which is still one model step.
- A second shell is built for a bash call that scripts the browser, once, at its first call.
- A script that loops past the bash call's `yieldMs` goes on in the background as any command does, and the follow-up, taken when the call returned, describes the page as it was then.
- The lines kept for the end of the call are capped at eight, so a long loop in a tab someone else keeps using reports the first of them.

## What would change it

Evals showing agents write worse scripts against the command line than they would against a typed API, or loop far enough that the cost of a command per call matters, would argue for a batch form or typed results on top of this one. A capability that needs a typed browser result on the command line would move the work out of the shell's command and into the capability, with the command generated from it as `instrument`'s are.
