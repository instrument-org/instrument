import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const WATCHDOG = fileURLToPath(new URL("./quit-watchdog.ts", import.meta.url));

it("ends a process whose main thread never comes back", async () => {
  // The main thread spins forever after arming, as it did in a quit that hung.
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `const { armQuitWatchdog } = await import(${JSON.stringify(WATCHDOG)});
       armQuitWatchdog(200);
       for (;;) {}`,
    ],
    { stdio: "ignore" },
  );
  const started = Date.now();
  const ended = await new Promise<{ signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("exit", (_code, signal) => {
        resolve({ signal });
      });
    },
  );
  expect(Date.now() - started).toBeLessThan(5000);
  expect(ended.signal ?? "SIGKILL").toBe("SIGKILL");
});

it("leaves a process that exits in time to exit on its own", async () => {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `const { armQuitWatchdog } = await import(${JSON.stringify(WATCHDOG)});
       armQuitWatchdog(60_000);`,
    ],
    { stdio: "ignore" },
  );
  const code = await new Promise<number | null>((resolve) => {
    child.on("exit", (exitCode) => {
      resolve(exitCode);
    });
  });
  expect(code).toBe(0);
});
