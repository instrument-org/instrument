import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { withShellOutputSink } from "./output-sink";
import { pipeHandle, type StageHandoff, startPipeStage } from "./pipe-stage";

const MIB = 1024 * 1024;

/** A Node program, as a stage runs one. */
const node = (code: string): [string, string[]] => [
  process.execPath,
  ["-e", code],
];

const writeMib = node(`process.stdout.write(Buffer.alloc(${MIB}, 97))`);
const countStdin = node(
  "let n = 0; process.stdin.on('data', (c) => (n += c.length)); process.stdin.on('end', () => console.log(n))",
);

/** A stage that ran to the end rather than handing its stdout on. */
async function finished(stage: ReturnType<typeof startPipeStage>) {
  const result = await stage;
  if ("token" in result) {
    throw new Error("the stage handed its stdout on");
  }
  return result;
}

function handoff(stage: ReturnType<typeof startPipeStage>): StageHandoff {
  if (!("token" in stage)) {
    throw new Error("the stage did not hand its stdout on");
  }
  return stage;
}

describe("the private pipe handle a handoff relies on", () => {
  // Node gives no public way to keep a child's stdout unread until another
  // child takes it: libuv starts reading as soon as Node wraps the pipe. The
  // stage stops it through the handle's readStop, which Node keeps private.
  // If this fails after a Node or Electron upgrade, stages fall back to the
  // buffered path (pipeHandle returns undefined) and pipelines stop streaming.
  it("is still on a child's stdout with readStart, readStop and reading", () => {
    const child = spawn(process.execPath, ["-e", ""], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const handle = child.stdout && pipeHandle(child.stdout);
    child.stdout?.resume();
    expect(
      handle,
      "Node changed the private handle of a child's stdout",
    ).toBeDefined();
  });

  it("keeps every byte in the pipe until the next program takes it", async () => {
    const producer = handoff(
      startPipeStage(...writeMib, { cwd: process.cwd(), offerHandoff: true }),
    );
    // Long enough for libuv to have read the first 64 KiB, had it started.
    await sleep(200);
    const consumer = await finished(
      startPipeStage(...countStdin, {
        cwd: process.cwd(),
        offerHandoff: false,
        stdinHandoff: producer.token,
      }),
    );
    expect(consumer.stdout).toBe(`${MIB}\n`);
    expect((await producer.settle({ discard: true })).exitCode).toBe(0);
  });
});

describe("startPipeStage", () => {
  it("gives a consumer that is not a program the bytes", async () => {
    const producer = handoff(
      startPipeStage(...writeMib, { cwd: process.cwd(), offerHandoff: true }),
    );
    await sleep(50);
    const settled = await producer.settle();
    expect(settled.stdout.length).toBe(MIB);
  });

  it("ends a producer whose reader exits early with SIGPIPE", async () => {
    const producer = handoff(
      startPipeStage(
        ...node(
          "setInterval(() => process.stdout.write('y\\n'.repeat(4096)), 1)",
        ),
        { cwd: process.cwd(), offerHandoff: true },
      ),
    );
    const consumer = await finished(
      startPipeStage(
        ...node(
          "process.stdin.once('data', (c) => { console.log(c.length > 0); process.exit(0) })",
        ),
        {
          cwd: process.cwd(),
          offerHandoff: false,
          stdinHandoff: producer.token,
        },
      ),
    );
    expect(consumer.stdout).toBe("true\n");
    const settled = await producer.settle({ discard: true });
    // Node reports the closed pipe as EPIPE and exits 1 where a C program
    // would die of SIGPIPE (141); either way it ends.
    expect(settled.exitCode).not.toBe(0);
  });

  it("lets a small output nobody read finish, as a kernel pipe would", async () => {
    const producer = handoff(
      startPipeStage(...node("console.log('short')"), {
        cwd: process.cwd(),
        offerHandoff: true,
      }),
    );
    expect((await producer.settle({ discard: true })).exitCode).toBe(0);
  });

  it("stops a producer when the run it belongs to is aborted", async () => {
    const producer = handoff(
      startPipeStage(...node("setInterval(() => {}, 1000)"), {
        cwd: process.cwd(),
        offerHandoff: true,
      }),
    );
    const run = new AbortController();
    const settled = producer.settle({ signal: run.signal });
    run.abort();
    expect((await settled).exitCode).toBe(143);
  });

  it("streams only the last stage's stdout to a background run, and every stage's stderr", async () => {
    const lines: string[] = [];
    await withShellOutputSink(
      (text) => {
        lines.push(text);
      },
      async () => {
        const producer = handoff(
          startPipeStage(
            ...node("console.error('from producer'); console.log('raw')"),
            { cwd: process.cwd(), offerHandoff: true },
          ),
        );
        await startPipeStage(
          ...node(
            "process.stdin.on('data', (c) => process.stdout.write(String(c).toUpperCase()))",
          ),
          {
            cwd: process.cwd(),
            offerHandoff: false,
            stdinHandoff: producer.token,
          },
        );
        await producer.settle({ discard: true });
      },
    );
    const streamed = lines.join("");
    expect(streamed).toContain("from producer\n");
    expect(streamed).toContain("RAW\n");
    expect(streamed).not.toContain("raw\n");
  });
});
