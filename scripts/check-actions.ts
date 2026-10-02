import { spawnSync } from "node:child_process";

const found = spawnSync("command", ["-v", "actionlint"], { shell: true });

if (found.status !== 0) {
  console.warn(
    "warning: actionlint not installed, skipping workflow checks (brew install actionlint)",
  );
  process.exit(0);
}

const result = spawnSync("actionlint", { stdio: "inherit" });
process.exit(result.status ?? 1);
