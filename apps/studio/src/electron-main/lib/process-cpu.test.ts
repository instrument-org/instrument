import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getAppMetrics: vi.fn(() => []) },
  powerMonitor: { on: vi.fn() },
  webContents: { getAllWebContents: vi.fn(() => []) },
}));
vi.mock("./electron-logger", () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));

const { createCpuWatch, MAX_REPORTS } = await import("./process-cpu");

const MINUTE = 60_000;

function setup() {
  const lines: string[] = [];
  const watch = createCpuWatch({
    labelOf: (sample) =>
      sample.type === "GPU"
        ? "GPU process"
        : "browser tab renderer (music.youtube.com)",
    log: {
      info: (line: string) => lines.push(`info ${line}`),
      warn: (line: string) => lines.push(`warn ${line}`),
    },
  });
  const run = (reads: { gpu: number; tab?: number }[]) => {
    reads.forEach((read, index) => {
      watch.observe(
        [
          { cpu: read.gpu, pid: 1, type: "GPU" },
          ...(read.tab === undefined
            ? []
            : [{ cpu: read.tab, pid: 2, type: "Tab" }]),
        ],
        (index + 1) * MINUTE,
      );
    });
  };
  return { lines, run, watch };
}

describe("createCpuWatch", () => {
  it("logs one line when an episode starts and one when it ends", () => {
    const { lines, run } = setup();
    run([
      { gpu: 37, tab: 8 },
      { gpu: 28, tab: 7 },
      { gpu: 22, tab: 7 },
      { gpu: 21, tab: 7 },
      { gpu: 25, tab: 8 },
      { gpu: 4, tab: 1 },
    ]);
    expect(lines).toMatchInlineSnapshot(`
      [
        "warn Sustained CPU: GPU process at 22% for 3 min",
        "info Sustained CPU ended: GPU process after 6 min, average 27%, peak 37%",
      ]
    `);
  });

  it("names the GPU process beside a hot renderer", () => {
    const { lines, run } = setup();
    run([
      { gpu: 12, tab: 40 },
      { gpu: 13, tab: 35 },
      { gpu: 12, tab: 30 },
    ]);
    expect(lines).toMatchInlineSnapshot(`
      [
        "warn Sustained CPU: browser tab renderer (music.youtube.com) at 30% for 3 min; GPU process at 12%",
      ]
    `);
  });

  it("logs nothing for a spike shorter than the episode", () => {
    const { lines, run } = setup();
    run([{ gpu: 90 }, { gpu: 90 }, { gpu: 5 }, { gpu: 90 }]);
    expect(lines).toEqual([]);
  });

  it("ends an episode when its process goes away", () => {
    const { lines, run, watch } = setup();
    run([
      { gpu: 1, tab: 30 },
      { gpu: 1, tab: 30 },
      { gpu: 1, tab: 30 },
    ]);
    watch.observe([{ cpu: 1, pid: 1, type: "GPU" }], 5 * MINUTE);
    expect(lines.at(-1)).toMatchInlineSnapshot(
      `"info Sustained CPU ended: browser tab renderer (music.youtube.com) after 5 min, average 30%, peak 30%"`,
    );
  });

  it("stops reporting after the launch's cap", () => {
    const { lines, watch } = setup();
    const hot = Array.from({ length: MAX_REPORTS + 5 }, (_, pid) => ({
      cpu: 50,
      pid,
      type: "Tab",
    }));
    for (let read = 1; read <= 4; read += 1) {
      watch.observe(hot, read * MINUTE);
    }
    expect(lines.length).toBe(MAX_REPORTS + 1);
    expect(lines.at(-1)).toMatchInlineSnapshot(
      `"warn Sustained CPU: further reports suppressed until the next launch"`,
    );
  });
});
