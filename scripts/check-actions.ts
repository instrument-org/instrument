import { spawnSync } from "node:child_process";

const found = spawnSync("command", ["-v", "actionlint"], { shell: true });

if (found.status !== 0) {
  console.warn(
    "warning: actionlint not installed, skipping workflow checks (brew install actionlint)",
  );
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(0);
}

const result = spawnSync("actionlint", { stdio: "inherit" });
// eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
process.exit(result.status ?? 1);
