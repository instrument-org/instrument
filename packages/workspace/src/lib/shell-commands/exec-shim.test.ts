import { describe, expect, it } from "vitest";

import { execShim } from "./exec-shim";

const runNode = (code: string) => execShim(process.execPath, ["-e", code], {});

describe("execShim", () => {
  // execa strips a trailing newline by default. The interpreter concatenates
  // each command's output into one buffer, so losing it silently runs one
  // command's last line into the next command's first.
  it("keeps the trailing newline", async () => {
    const result = await runNode("console.log('a')");
    expect(result.all).toBe("a\n");
  });

  it("keeps every trailing newline, not just the last", async () => {
    const result = await runNode("process.stdout.write('a\\n\\n\\n')");
    expect(result.all).toBe("a\n\n\n");
  });

  it("merges stderr into the returned output", async () => {
    const result = await runNode(
      "process.stdout.write('out\\n'); process.stderr.write('err\\n')",
    );
    expect(result.all).toContain("out");
    expect(result.all).toContain("err");
  });

  it("reports a non-zero exit as a code rather than throwing", async () => {
    const result = await runNode("process.exit(3)");
    expect(result.exitCode).toBe(3);
  });
});
