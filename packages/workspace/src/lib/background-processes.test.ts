import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TASK_FOLDER_NAMES } from "../constants";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { absolutePathJoin } from "./absolute-path-join";
import {
  killBackgroundProcess,
  killSessionBackgroundProcesses,
  listBackgroundProcesses,
  MAX_RUNNING_BACKGROUND_PROCESSES,
  promoteBackgroundProcess,
  readBackgroundProcess,
  startBackgroundRun,
} from "./background-processes";
import { currentShellOutputSink } from "./shell-commands/output-sink";
import { taskDir } from "./task-dir-utils";

const usedSessionIds: StoreId.Session[] = [];

/**
 * A run the test drives by hand: it emits through the sink the registry installs
 * (which is how the real native-binary shims stream) and finishes when told to.
 */
function controllableRun() {
  let settle: (value: { exitCode: number; output: string }) => void = () => {
    return;
  };
  let emit: (text: string) => Promise<void> = async () => {
    await Promise.resolve();
  };
  let aborted = false;

  let fail: (reason: Error) => void = () => {
    return;
  };

  return {
    get aborted() {
      return aborted;
    },
    emit: async (text: string) => {
      await emit(text);
    },
    finish: (value: { exitCode: number; output: string }) => {
      settle(value);
    },
    run: ({ signal }: { signal: AbortSignal }) => {
      const sink = currentShellOutputSink();
      if (!sink) {
        throw new Error("expected an output sink to be installed");
      }
      emit = async (text) => {
        await sink(text);
      };
      signal.addEventListener("abort", () => {
        aborted = true;
        // A real killed subprocess settles: execa rejects once the child is gone.
        // Without this the double would look like a process ignoring SIGTERM.
        fail(new Error("aborted"));
      });
      return new Promise<{ exitCode: number; output: string }>(
        (resolve, reject) => {
          settle = resolve;
          fail = reject;
        },
      );
    },
  };
}

/**
 * A task to hold log files, plus its own session, which is what the registry keys
 * on. Separate sessions keep the module-level registry from leaking ids between
 * tests.
 *
 * The task directory is cleared because the mock workspace is a fixed path: logs
 * written by an earlier run would otherwise still be there, and ids are handed out
 * from what is on disk, so every run would start further along than the last.
 */
function makeOwner(name: string) {
  const taskId = TaskIdSchema.parse(
    `01k${name
      .replaceAll(/[^a-z0-9]/g, "")
      .padEnd(23, "0")
      .slice(0, 23)}`,
  );
  createMockTaskConfig(taskId);
  rmSync(taskDir(taskId), { force: true, recursive: true });
  const sessionId = StoreId.newSessionId();
  usedSessionIds.push(sessionId);
  return { sessionId, taskId };
}

function promote(owner: ReturnType<typeof makeOwner>, command: string) {
  const controllable = controllableRun();
  const handle = startBackgroundRun({
    callerSignal: new AbortController().signal,
    command,
    run: controllable.run,
    taskId: owner.taskId,
  });
  const promoted = promoteBackgroundProcess({ handle, ...owner });
  if ("error" in promoted) {
    throw new Error(promoted.error);
  }
  return { controllable, handle, info: promoted.info };
}

afterEach(async () => {
  await Promise.all(
    usedSessionIds.splice(0).map((id) => killSessionBackgroundProcesses(id)),
  );
});

describe("background processes", () => {
  it("streams a running command's output to successive reads", async () => {
    const owner = makeOwner("streams");
    const { controllable, info } = promote(owner, "node work/server.js");
    await controllable.emit("listening\n");

    const first = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 0,
    });
    expect(first?.output).toBe("listening\n");
    expect(first?.info.status).toBe("running");

    await controllable.emit("request /\n");
    const second = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 0,
    });
    // Only what arrived since the previous read.
    expect(second?.output).toBe("request /\n");

    const third = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 0,
    });
    expect(third?.output).toBe("");
  });

  it("returns early from a long wait when the command exits", async () => {
    const owner = makeOwner("exits");
    const { controllable, info } = promote(owner, "pnpm build");
    await controllable.emit("building\n");

    const read = readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 60_000,
    });
    controllable.finish({ exitCode: 0, output: "building\ndone\n" });

    const result = await read;
    expect(result?.info.status).toBe("exited");
    expect(result?.info.exitCode).toBe(0);
    expect(result?.timedOut).toBe(false);
    // The final shell output includes a builtin line that did not stream, so it
    // is labeled and appended instead of being silently lost.
    expect(result?.output).toMatchInlineSnapshot(`
      "building
      [final shell output]
      building
      done
      "
    `);
  });

  it("collects everything written during the wait, not just the first chunk", async () => {
    const owner = makeOwner("collects");
    const { controllable, info } = promote(owner, "node work/tick.js");

    const read = readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 80,
    });
    await controllable.emit("tick 1\n");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await controllable.emit("tick 2\n");

    const collected = await read;
    expect(collected?.output).toBe("tick 1\ntick 2\n");
  });

  it("hands a command that streamed nothing its whole output at exit", async () => {
    const owner = makeOwner("builtins");
    const { controllable, info } = promote(
      owner,
      "for i in 1 2; do echo $i; done",
    );
    controllable.finish({ exitCode: 0, output: "1\n2\n" });

    const read = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 1000,
    });
    expect(read?.output).toBe("1\n2\n");
  });

  it("aborts the run on kill and reports it as killed", async () => {
    const owner = makeOwner("kill");
    const { controllable, info } = promote(owner, "node work/server.js");

    const killed = await killBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
    });
    expect(killed?.info.status).toBe("killed");
    expect(killed?.stoppedByThisCall).toBe(true);
    expect(controllable.aborted).toBe(true);

    // A second kill is harmless, but must not claim it stopped anything.
    const again = await killBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
    });
    expect(again?.info.status).toBe("killed");
    expect(again?.stoppedByThisCall).toBe(false);
  });

  it("reports nothing for an unknown id", async () => {
    const owner = makeOwner("unknown");
    expect(
      await readBackgroundProcess({
        id: "bg_99",
        sessionId: owner.sessionId,
        waitMs: 0,
      }),
    ).toBeUndefined();
    expect(
      await killBackgroundProcess({ id: "bg_99", sessionId: owner.sessionId }),
    ).toBeUndefined();
  });

  it("refuses to promote past the running cap, naming what is live", () => {
    const owner = makeOwner("capped");
    for (let i = 0; i < MAX_RUNNING_BACKGROUND_PROCESSES; i++) {
      promote(owner, `node work/idle-${i}.js`);
    }

    const handle = startBackgroundRun({
      callerSignal: new AbortController().signal,
      command: "node work/one-too-many.js",
      run: controllableRun().run,
      taskId: owner.taskId,
    });
    const promoted = promoteBackgroundProcess({ handle, ...owner });

    expect("error" in promoted && promoted.error).toContain(
      "Too many background processes",
    );
    expect("error" in promoted && promoted.error).toContain("bg_1");
    expect(listBackgroundProcesses(owner.sessionId)).toHaveLength(
      MAX_RUNNING_BACKGROUND_PROCESSES,
    );
  });

  it("applies the running cap across sessions in one task", () => {
    const taskId = makeOwner("sharedcap").taskId;
    const sessions = Array.from(
      { length: MAX_RUNNING_BACKGROUND_PROCESSES },
      () => {
        const sessionId = StoreId.newSessionId();
        usedSessionIds.push(sessionId);
        return { sessionId, taskId };
      },
    );
    for (const [index, session] of sessions.entries()) {
      promote(session, `node work/idle-${index}.js`);
    }

    const extraSession = {
      sessionId: StoreId.newSessionId(),
      taskId,
    };
    usedSessionIds.push(extraSession.sessionId);
    const handle = startBackgroundRun({
      callerSignal: new AbortController().signal,
      command: "node work/one-too-many.js",
      run: controllableRun().run,
      taskId,
    });

    const promoted = promoteBackgroundProcess({ handle, ...extraSession });

    // A kill only reaches the session that started the process, so naming
    // another session's id would send the agent after one it cannot stop.
    expect("error" in promoted && promoted.error).toMatchInlineSnapshot(
      `"Too many background processes already running for this task (8). 8 of them were started by another session and cannot be stopped from here."`,
    );
    handle.abort();
  });

  it("names only the processes the refused session can kill", () => {
    const taskId = makeOwner("mixedcap").taskId;
    const others = Array.from(
      { length: MAX_RUNNING_BACKGROUND_PROCESSES - 1 },
      () => {
        const sessionId = StoreId.newSessionId();
        usedSessionIds.push(sessionId);
        return { sessionId, taskId };
      },
    );
    for (const [index, session] of others.entries()) {
      promote(session, `node work/theirs-${index}.js`);
    }

    const owner = { sessionId: StoreId.newSessionId(), taskId };
    usedSessionIds.push(owner.sessionId);
    promote(owner, "node work/mine.js");

    const handle = startBackgroundRun({
      callerSignal: new AbortController().signal,
      command: "node work/one-too-many.js",
      run: controllableRun().run,
      taskId,
    });
    const promoted = promoteBackgroundProcess({ handle, ...owner });

    expect("error" in promoted && promoted.error).toMatchInlineSnapshot(
      `"Too many background processes already running for this task (8). Kill one before starting another: bg_8 (node work/mine.js). 7 of them were started by another session and cannot be stopped from here."`,
    );
    handle.abort();
  });

  it("keeps a promoted run alive after its caller's signal aborts", async () => {
    const owner = makeOwner("detaches");
    const controller = new AbortController();
    const controllable = controllableRun();
    const handle = startBackgroundRun({
      callerSignal: controller.signal,
      command: "node work/server.js",
      run: controllable.run,
      taskId: owner.taskId,
    });
    const promoted = promoteBackgroundProcess({ handle, ...owner });
    if ("error" in promoted) {
      throw new Error(promoted.error);
    }

    // The tool call that started the run returns, aborting its signal.
    controller.abort();
    await controllable.emit("still here\n");

    expect(controllable.aborted).toBe(false);
    const read = await readBackgroundProcess({
      id: promoted.info.id,
      sessionId: owner.sessionId,
      waitMs: 0,
    });
    expect(read?.output).toBe("still here\n");
  });

  it("cancels a run that was never promoted when its caller aborts", () => {
    const owner = makeOwner("unpromoted");
    const controller = new AbortController();
    const controllable = controllableRun();
    startBackgroundRun({
      callerSignal: controller.signal,
      command: "node work/short.js",
      run: controllable.run,
      taskId: owner.taskId,
    });

    controller.abort();

    expect(controllable.aborted).toBe(true);
  });

  it("writes the complete output to the process's log file", async () => {
    const owner = makeOwner("logs");
    const { controllable, info } = promote(owner, "node work/tick.js");
    await controllable.emit("tick 1\n");
    controllable.finish({ exitCode: 0, output: "tick 1\n" });
    await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 1000,
    });

    const log = await fs.readFile(
      absolutePathJoin(taskDir(owner.taskId), info.logFilePath),
      "utf8",
    );
    expect(log).toMatchInlineSnapshot(`
      "$ node work/tick.js
      tick 1
      "
    `);
  });

  it("appends same-length final shell output when its content differs", async () => {
    const owner = makeOwner("transformed");
    const { controllable, handle, info } = promote(
      owner,
      "node work/lower.js | transform",
    );
    await controllable.emit("lower\n");
    await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 0,
    });

    controllable.finish({ exitCode: 0, output: "UPPER\n" });
    await handle.completion;
    const finalRead = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 1000,
    });

    expect(finalRead?.output).toMatchInlineSnapshot(`
      "[final shell output]
      UPPER
      "
    `);
  });

  it("explains when shell redirection consumes live subprocess output", async () => {
    const owner = makeOwner("redirected");
    const { controllable, handle, info } = promote(
      owner,
      "node work/report.js > work/report.txt",
    );
    await controllable.emit("written to the file\n");
    await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 0,
    });

    controllable.finish({ exitCode: 0, output: "" });
    await handle.completion;
    const finalRead = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 1000,
    });

    expect(finalRead?.output).toMatchInlineSnapshot(`
      "[final shell output was empty; earlier live subprocess output was consumed or redirected by the shell]
      "
    `);
  });

  it("does not append final shell output when it matches streamed output", async () => {
    const owner = makeOwner("duplicate");
    const { controllable, handle, info } = promote(
      owner,
      "node work/report.js",
    );
    await controllable.emit("same\n");
    await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 0,
    });

    controllable.finish({ exitCode: 0, output: "same\n" });
    await handle.completion;
    const finalRead = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 1000,
    });

    expect(finalRead?.output).toBe("");
  });

  it("cancels a run whose caller had already aborted", () => {
    const owner = makeOwner("prealigned");
    const controller = new AbortController();
    // Stopped between the tool call being scheduled and this running, which
    // fires no listener because the abort already happened.
    controller.abort();

    let runSignal: AbortSignal | undefined;
    startBackgroundRun({
      callerSignal: controller.signal,
      command: "node work/short.js",
      run: ({ signal }) => {
        runSignal = signal;
        return new Promise<{ exitCode: number; output: string }>(() => {
          // Never settles; the assertion is on the signal it was handed.
        });
      },
      taskId: owner.taskId,
    });

    // What a real shim reads: execa rejects an already-aborted cancelSignal,
    // and `watchSubprocessTree` tears the tree down on one.
    expect(runSignal?.aborted).toBe(true);
  });

  it("does not duplicate final output when a chunk redacts to nothing", async () => {
    const owner = makeOwner("emptied");
    const { controllable, handle, info } = promote(owner, "node work/app.js");

    // Redacted away entirely outside production, which hands the sink an empty
    // chunk even though a non-empty one arrived. It has to be the last chunk:
    // any chunk after it would set the ends-with-newline flag correctly again.
    await controllable.emit("same\n");
    await controllable.emit("Debugger attached.\n");
    controllable.finish({ exitCode: 0, output: "same\n" });
    await handle.completion;

    const read = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 1000,
    });
    // The streamed copy and the final output agree, so there is nothing to add.
    expect(read?.output).not.toContain("[final shell output]");
  });

  it("does not duplicate output that differs only in path separators", async () => {
    const owner = makeOwner("separators");
    const { controllable, handle, info } = promote(owner, "git status");

    // The live view keeps backslashes; the final shell output has them rewritten
    // to forward slashes. Same content, so there is nothing to append.
    await controllable.emit("modified: work\\src\\index.ts\n");
    controllable.finish({
      exitCode: 0,
      output: "modified: work/src/index.ts\n",
    });
    await handle.completion;

    const read = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 1000,
    });
    expect(read?.output).not.toContain("[final shell output]");
  });

  it("isolates one session's processes from another in the same task", async () => {
    const taskId = makeOwner("shared").taskId;
    const sessionA = { sessionId: StoreId.newSessionId(), taskId };
    const sessionB = { sessionId: StoreId.newSessionId(), taskId };
    usedSessionIds.push(sessionA.sessionId, sessionB.sessionId);

    const a = promote(sessionA, "node work/a.js");
    const b = promote(sessionB, "node work/b.js");
    await a.controllable.emit("from a\n");
    await b.controllable.emit("from b\n");

    // A read in one session cannot see or drain the other's output.
    const crossRead = await readBackgroundProcess({
      id: b.info.id,
      sessionId: sessionA.sessionId,
      waitMs: 0,
    });
    expect(crossRead).toBeUndefined();

    // Ending session A's turn must leave session B running.
    await killSessionBackgroundProcesses(sessionA.sessionId);
    expect(a.controllable.aborted).toBe(true);
    expect(b.controllable.aborted).toBe(false);

    const ownRead = await readBackgroundProcess({
      id: b.info.id,
      sessionId: sessionB.sessionId,
      waitMs: 0,
    });
    expect(ownRead?.output).toBe("from b\n");
  });

  it("refuses promotion while session cleanup is in flight", async () => {
    const owner = makeOwner("closing");
    let settle: (() => void) | undefined;
    const handle = startBackgroundRun({
      callerSignal: new AbortController().signal,
      command: "node work/first.js",
      run: ({ signal }) =>
        new Promise<{ exitCode: number; output: string }>((resolve) => {
          signal.addEventListener("abort", () => {
            settle = () => {
              resolve({ exitCode: 0, output: "" });
            };
          });
        }),
      taskId: owner.taskId,
    });
    const first = promoteBackgroundProcess({ handle, ...owner });
    if ("error" in first) {
      throw new Error(first.error);
    }

    const cleanup = killSessionBackgroundProcesses(owner.sessionId);
    await Promise.resolve();
    const second = startBackgroundRun({
      callerSignal: new AbortController().signal,
      command: "node work/second.js",
      run: controllableRun().run,
      taskId: owner.taskId,
    });
    const promoted = promoteBackgroundProcess({
      handle: second,
      ...owner,
    });

    expect(promoted).toMatchObject({
      error:
        "This session is closing, so it cannot start a background process.",
    });
    settle?.();
    await cleanup;
    second.abort();
  });

  it("does not reuse an id after a session's processes are killed", async () => {
    const taskId = makeOwner("reuse").taskId;
    const first = { sessionId: StoreId.newSessionId(), taskId };
    const second = { sessionId: StoreId.newSessionId(), taskId };
    usedSessionIds.push(first.sessionId, second.sessionId);

    const before = promote(first, "node work/a.js");
    await killSessionBackgroundProcesses(first.sessionId);
    const after = promote(second, "node work/b.js");

    // A persisted tool result names the log file, so a later turn must not open
    // the same path and overwrite it.
    expect(after.info.id).not.toBe(before.info.id);
    expect(after.info.logFilePath).not.toBe(before.info.logFilePath);
  });

  it("does not reuse an id a previous run already wrote a log for", async () => {
    const owner = makeOwner("restart");
    // The counter lives in memory, so a task it has never seen is the state every
    // task is in right after the app restarts.
    const outputDir = absolutePathJoin(
      taskDir(owner.taskId),
      TASK_FOLDER_NAMES.work,
      TASK_FOLDER_NAMES.toolOutput,
    );
    await fs.mkdir(outputDir, { recursive: true });
    const staleOutput = "output an earlier transcript points at\n";
    const firstLog = absolutePathJoin(outputDir, "bg_1.log");
    await fs.writeFile(firstLog, staleOutput, "utf8");
    await fs.writeFile(absolutePathJoin(outputDir, "bg_3.log"), "", "utf8");

    const { info } = promote(owner, "node work/server.js");

    // Past the highest id on disk, not just past the ones this run handed out.
    expect(info.id).toBe("bg_4");
    // The log is opened for writing, which truncates, so starting over at bg_1
    // would have emptied a file a persisted tool result still names.
    expect(await fs.readFile(firstLog, "utf8")).toBe(staleOutput);
  });

  it("bounds what a single read accumulates", async () => {
    const owner = makeOwner("bounded");
    const { controllable, info } = promote(owner, "node work/flood.js");

    // Three megabytes, far past the megabyte a read retains, emitted before the
    // read drains. Written as few large chunks rather than many small ones: the
    // bound under test is on bytes, and every chunk pays for redaction and an
    // eviction pass, which is what made this the slowest test in the file.
    const line = `${"y".repeat(4095)}\n`;
    for (let i = 0; i < 750; i++) {
      await controllable.emit(line);
    }

    const read = await readBackgroundProcess({
      id: info.id,
      sessionId: owner.sessionId,
      waitMs: 0,
    });
    expect(read?.omittedBytes).toBeGreaterThan(0);
    expect(Buffer.byteLength(read?.output ?? "", "utf8")).toBeLessThan(
      4 * 1024 * 1024,
    );
  }, 20_000);

  it("stops an unobserved process when its age limit expires", async () => {
    vi.useFakeTimers();
    try {
      const owner = makeOwner("expires");
      const { controllable, info } = promote(
        owner,
        "node work/forgotten-server.js",
      );

      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      await Promise.resolve();

      expect(controllable.aborted).toBe(true);
      expect(
        listBackgroundProcesses(owner.sessionId).find(
          (process) => process.id === info.id,
        )?.status,
      ).toBe("killed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a process that ignores the stop request", async () => {
    const owner = makeOwner("stubborn");
    let settle: (() => void) | undefined;
    const handle = startBackgroundRun({
      callerSignal: new AbortController().signal,
      command: "node work/stubborn.js",
      taskId: owner.taskId,
      // Never settles, even once aborted: stands in for a child that ignores
      // SIGTERM and outlives execa's escalation.
      run: () =>
        new Promise<{ exitCode: number; output: string }>((resolve) => {
          settle = () => {
            resolve({ exitCode: 0, output: "" });
          };
        }),
    });
    const promoted = promoteBackgroundProcess({ handle, ...owner });
    if ("error" in promoted) {
      throw new Error(promoted.error);
    }

    const killed = await killBackgroundProcess({
      id: promoted.info.id,
      sessionId: owner.sessionId,
    });

    expect(killed?.info.status).toBe("termination-uncertain");
    expect(killed?.terminationConfirmed).toBe(false);
    const read = await readBackgroundProcess({
      id: promoted.info.id,
      sessionId: owner.sessionId,
      waitMs: 0,
    });
    expect(read?.output).toContain("may still be running");
    settle?.();
    await handle.completion;
    await Promise.resolve();
    expect(
      listBackgroundProcesses(owner.sessionId).find(
        (process) => process.id === promoted.info.id,
      )?.status,
    ).toBe("killed");
  }, 20_000);

  it("releases a session holding a record an earlier kill could not confirm", async () => {
    const owner = makeOwner("stranded");
    const handle = startBackgroundRun({
      callerSignal: new AbortController().signal,
      command: "node work/stubborn.js",
      run: () =>
        new Promise<{ exitCode: number; output: string }>(() => {
          // Never settles, even once aborted, so the kill cannot confirm it.
        }),
      taskId: owner.taskId,
    });
    const promoted = promoteBackgroundProcess({ handle, ...owner });
    if ("error" in promoted) {
      throw new Error(promoted.error);
    }
    await killBackgroundProcess({
      id: promoted.info.id,
      sessionId: owner.sessionId,
    });

    // Nothing is running now, so deleting the session has nothing left to stop
    // and must not keep failing on the record the earlier kill gave up on.
    await expect(
      killSessionBackgroundProcesses(owner.sessionId),
    ).resolves.toBeUndefined();
    expect(listBackgroundProcesses(owner.sessionId)).toEqual([]);
  }, 20_000);

  it("kills every running process for a session at once", async () => {
    const owner = makeOwner("kills");
    const first = promote(owner, "node work/a.js");
    const second = promote(owner, "node work/b.js");

    await killSessionBackgroundProcesses(owner.sessionId);

    expect(first.controllable.aborted).toBe(true);
    expect(second.controllable.aborted).toBe(true);
    expect(listBackgroundProcesses(owner.sessionId)).toEqual([]);
  });
});
