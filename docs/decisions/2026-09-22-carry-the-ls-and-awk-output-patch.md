# Carry just-bash's linear `ls` and awk `printf` output as a local patch rather than guard the commands ourselves

Date: 2026-09-22

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way [2026-09-08-carry-the-find-patch.md](2026-09-08-carry-the-find-patch.md), [2026-09-09-carry-the-stat-patch.md](2026-09-09-carry-the-stat-patch.md), [2026-09-10-carry-the-cross-mount-copy-patch.md](2026-09-10-carry-the-cross-mount-copy-patch.md), [2026-09-10-carry-the-python-worker-patch.md](2026-09-10-carry-the-python-worker-patch.md), and [2026-09-21-carry-the-stdin-connected-patch.md](2026-09-21-carry-the-stdin-connected-patch.md) do.

## Context

The window freezes when the agent walks a large attached folder, and `ls -R` was the worst walk there is. Over an attached home directory of about 8M files it spent 367 seconds, 223 seconds of CPU and 3.6 GB on the Electron main thread before the traversal budget stopped it with nothing printed; `find` reaches the same budget in 3.5 seconds.

Two defects in 3.4.1's `ls` account for it. `appendLsOutput` checked the output limit by measuring everything written so far on every append, which is quadratic, and sat on every path that writes, so `ls -l` on one 20,000-entry directory took two minutes with no recursion at all. And `ls` charged the traversal budget once per directory entered rather than once per name read, so a recursive listing stopped after about 300,000 directories, more than half of a home folder, where `find` stops after 300,000 names. A sweep of the rest of just-bash for the same accumulator found one more that bites: awk's `printf` measured all of awk's output per call, 42 seconds over 40,000 records where `print` takes 0.15.

## Options weighed

**Refuse `ls -R` over an attached folder in a command of our own.** Built and measured first: an `ls` custom command that refused `-R` over `/mnt` and `/project` and named `rg --files` and `find -maxdepth` instead, turning six minutes into 18 milliseconds. Rejected because it is a shim over a just-bash command we would maintain indefinitely, it leaves `ls -l` on a large directory quadratic, and it answers a defect upstream can fix with a rule the model has to route around.

**Lower the budget for every shell.** Rejected for tasks. The budget counts entries, not time, and the cost of an entry varies about a hundredfold by command, so no single number bounds `ls -R` without making `find` useless. It is the right lever for the orchestrator alone, whose shell only reads what tasks produced, and that shell gets 20,000 alongside this patch.

**Patch the published bundle.** Chosen. The output fix is upstream as [vercel-labs/just-bash#449](https://github.com/vercel-labs/just-bash/pull/449) and the awk fix as [#450](https://github.com/vercel-labs/just-bash/pull/450); the entry charging is upstream already as #390, merged after 3.4.1. 3.4.1 builds byte-for-byte reproducibly from its tag, so the three changes were applied to the tag's source and carried as the rebuilt contents of the two published chunks they touch, rather than hand-edited into minified code. `ls -R` over the same home directory now stops in 22 seconds with 13 seconds of CPU, and `ls -l` on 20,000 entries takes a third of a second. `create-bash-env-ls.test.ts` and `create-bash-env-awk.test.ts` fail the moment either chunk reverts, verified by swapping the published chunks back in.

## Decision

Carry the sixth and seventh parts of `patches/just-bash@3.4.1.patch` until #449, #390 and #450 are in a version we install, then drop them. The 3.4.1 port also takes #390's sequential descent in place of 3.4.1's parallel batches, since a shared output needs one writer at a time; section order is unchanged because 3.4.1 already sorted its batched results by the same key.

What stays open: `ls -R` still reads each directory twice and costs about twice what `find` does, and `du` has no native equivalent, so a question about a folder's size still spends its budget on the main thread. Both are measured in [agent-filesystem-work-stalls-the-window.md](../findings/agent-filesystem-work-stalls-the-window.md), whose resolution is moving the agent turn off that thread.
