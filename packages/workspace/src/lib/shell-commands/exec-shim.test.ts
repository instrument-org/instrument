import { describe, expect, it } from "vitest";

import { execShim, mapStreams, shimOutput } from "./exec-shim";

const runNode = (code: string) => execShim(process.execPath, ["-e", code], {});

describe("execShim", () => {
  // execa strips a trailing newline by default. The interpreter concatenates
  // each command's output into one buffer, so losing it silently runs one
  // command's last line into the next command's first.
  it("keeps the trailing newline", async () => {
    const result = await runNode("console.log('a')");
    expect(result.stdout).toBe("a\n");
  });

  it("keeps every trailing newline, not just the last", async () => {
    const result = await runNode("process.stdout.write('a\\n\\n\\n')");
    expect(result.stdout).toBe("a\n\n\n");
  });

  // The whole point of the split: a redirection can only mean what it says if
  // the two streams arrive apart. Merged, `cmd > file` buries the diagnostic in
  // the file and `2>/dev/null` has nothing to silence.
  it("keeps stderr out of stdout", async () => {
    const result = await runNode(
      "process.stdout.write('out\\n'); process.stderr.write('err\\n')",
    );
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
  });

  it("reports a non-zero exit as a code rather than throwing", async () => {
    const result = await runNode("process.exit(3)");
    expect(result.exitCode).toBe(3);
  });
});

describe("shimOutput", () => {
  it("substitutes a diagnostic when the cwd does not exist", async () => {
    const result = await execShim(process.execPath, ["-e", ""], {
      cwd: "/no/such/directory",
    });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBeUndefined();

    const output = shimOutput(result, "node");
    expect(output.stderr).toContain("node could not start.");
    expect(output.stderr).toContain("/no/such/directory");
    expect(output.stdout).toBe("");
  });

  // execa opens shortMessage with the resolved binary path, which for the
  // bundled git and ffmpeg is a real path inside the installed app bundle that
  // no other sandbox output would ever show.
  it("never leaks the resolved binary path", async () => {
    const result = await execShim(process.execPath, ["-e", ""], {
      cwd: "/no/such/directory",
    });

    const output = shimOutput(result, "node");
    expect(output.stderr).not.toContain(process.execPath);
    expect(output.stderr).not.toContain("Command failed with");
  });

  it("substitutes a diagnostic when the binary is missing", async () => {
    const result = await execShim("instrument-no-such-binary", [], {});

    expect(shimOutput(result, "nope").stderr).toContain("ENOENT");
  });

  // rg reports no matches this way, and git diff --quiet reports a difference
  // this way. Both are answers, not failures, so neither may grow a diagnostic.
  it("leaves empty output alone when the process ran and exited non-zero", async () => {
    const result = await runNode("process.exit(1)");

    expect(result.exitCode).toBe(1);
    expect(shimOutput(result, "rg")).toEqual({ stderr: "", stdout: "" });
  });

  it("passes successful output through unchanged", async () => {
    const result = await runNode("console.log('ok')");

    expect(shimOutput(result, "node")).toEqual({ stderr: "", stdout: "ok\n" });
  });

  // A process that wrote only to stderr and then failed to report an exit code
  // still has something to say, so the diagnostic must not displace it.
  it("keeps real stderr rather than substituting a diagnostic", () => {
    const output = shimOutput(
      { exitCode: undefined, stderr: "real trouble\n", stdout: "" },
      "node",
    );

    expect(output.stderr).toBe("real trouble\n");
  });
});

describe("mapStreams", () => {
  it("applies the transform to both streams", () => {
    expect(
      mapStreams({ stderr: "b", stdout: "a" }, (text) => text.toUpperCase()),
    ).toEqual({ stderr: "B", stdout: "A" });
  });
});
