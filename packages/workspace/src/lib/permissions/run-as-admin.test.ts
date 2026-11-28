import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  MACOS_ADMIN_PROMPT,
  macosAdminScript,
  parseMacosRun,
  readMacosFailure,
  parseWindowsRun,
  powershellLiteral,
  windowsElevatedScript,
  windowsLauncherScript,
} from "./run-as-admin";

const execFileAsync = promisify(execFile);

/** Commands whose every character has to reach the shell as written. */
const AWKWARD = [
  `echo "double" 'single' '\`tick\`'`,
  "echo $HOME ${USER} $(whoami)",
  "printf 'a\\\\b\\n'",
  "echo one\necho two",
  "echo ‘curly’ “quotes”",
  `echo "it's"; echo done`,
];

describe("macosAdminScript", () => {
  it("passes the command as an argument, never inside the script", () => {
    const script = macosAdminScript().join("\n");
    for (const command of AWKWARD) {
      expect(script).not.toContain(command);
    }
    expect(script).toContain("quoted form of (item 1 of argv)");
    expect(script).toContain(
      `with prompt ${JSON.stringify(MACOS_ADMIN_PROMPT)}`,
    );
  });

  it.runIf(process.platform === "darwin").each(AWKWARD)(
    "runs %j in bash as written",
    async (command) => {
      // Without administrator privileges, so no prompt goes up.
      const script = macosAdminScript().map((line) =>
        line.replace(" with administrator privileges", ""),
      );
      const [{ stdout: expected }, { stdout }] = await Promise.all([
        execFileAsync("/bin/bash", ["-c", command]),
        execFileAsync("/usr/bin/osascript", [
          ...script.flatMap((line) => ["-e", line]),
          command,
        ]),
      ]);
      expect(parseMacosRun(stdout)).toEqual({
        exitCode: 0,
        is: "ran",
        output: expected.replace(/\n$/u, ""),
      });
    },
  );

  it.runIf(process.platform === "darwin")(
    "hands back a failing command's output and status",
    async () => {
      const script = macosAdminScript().map((line) =>
        line.replace(" with administrator privileges", ""),
      );
      const { stdout } = await execFileAsync("/usr/bin/osascript", [
        ...script.flatMap((line) => ["-e", line]),
        "echo out; echo err >&2; exit 3",
      ]);
      expect(parseMacosRun(stdout)).toEqual({
        exitCode: 3,
        is: "ran",
        output: "out\nerr",
      });
    },
  );
});

describe("parseMacosRun", () => {
  it.each([
    [
      "set time zone\n\n0\n",
      { exitCode: 0, is: "ran", output: "set time zone" },
    ],
    ["\n0\n", { exitCode: 0, is: "ran", output: "" }],
    ["no newline\n1", { exitCode: 1, is: "ran", output: "no newline" }],
  ])("reads %j", (stdout, expected) => {
    expect(parseMacosRun(stdout)).toEqual(expected);
  });

  it("fails on output with no status", () => {
    expect(parseMacosRun("what").is).toBe("failed");
  });
});

describe("readMacosFailure", () => {
  it.each([
    ["0:3: execution error: User canceled. (-128)", "canceled"],
    [
      "7:273: execution error: The administrator user name or password was incorrect. (-60007)",
      "no prompt",
    ],
    ["7:273: execution error: Something else. (-1)", "other"],
  ])("reads %s", (stderr, kind) => {
    const read = readMacosFailure(stderr, 1);
    if (kind === "canceled") {
      expect(read).toEqual({ is: "canceled" });
    } else if (kind === "no prompt") {
      expect(read).toMatchObject({
        is: "failed",
        message: expect.stringContaining("couldn't show its password prompt"),
      });
    } else {
      expect(read).toEqual({ is: "failed", message: stderr });
    }
  });
});

describe("powershellLiteral", () => {
  it.each([
    ["plain", "'plain'"],
    ["it's", "'it''s'"],
    ["‘curly’", "'‘‘curly’’'"],
    ["$env:TEMP \\ `n", "'$env:TEMP \\ `n'"],
    ["one\ntwo", "'one\ntwo'"],
  ])("quotes %j", (text, quoted) => {
    expect(powershellLiteral(text)).toBe(quoted);
  });
});

describe("windows scripts", () => {
  it("carries the command only as a literal inside the encoded script", () => {
    const command = `tzutil /s "Eastern Standard Time"; Write-Output 'it''s' $env:TEMP`;
    const elevated = windowsElevatedScript(command, "C:\\Temp\\out.txt");
    expect(elevated).toContain(
      `[scriptblock]::Create(${powershellLiteral(command)})`,
    );
    const launcher = windowsLauncherScript(command, "C:\\Temp\\out.txt");
    expect(launcher).not.toContain("tzutil");
    const encoded = /'-EncodedCommand','([A-Za-z0-9+/=]+)'/u.exec(
      launcher,
    )?.[1];
    expect(Buffer.from(encoded ?? "", "base64").toString("utf16le")).toBe(
      elevated,
    );
  });

  it.each([
    ["instrument-canceled\r\n", "", { is: "canceled" }],
    [
      "instrument-exit 0\r\n",
      "Done\r\nline two\r\n",
      { exitCode: 0, is: "ran", output: "Done\nline two" },
    ],
    ["instrument-exit 5", "", { exitCode: 5, is: "ran", output: "" }],
    [
      "instrument-failed Access is denied",
      "",
      { is: "failed", message: "Access is denied" },
    ],
  ])("reads %j", (stdout, output, expected) => {
    expect(parseWindowsRun(stdout, output)).toEqual(expected);
  });

  it.runIf(process.platform === "win32")(
    "runs the elevated script's command as written, unelevated",
    async () => {
      const folder = await fs.mkdtemp(path.join(os.tmpdir(), "admin-test-"));
      const outFile = path.join(folder, "out.txt");
      const command = "Write-Output 'it''s' \"$(1+1)\"; cmd /c exit 4";
      const encoded = Buffer.from(
        windowsElevatedScript(command, outFile),
        "utf16le",
      ).toString("base64");
      const exit = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encoded,
      ]).then(
        () => 0,
        (error: unknown) =>
          error instanceof Error && "code" in error ? error.code : undefined,
      );
      expect(exit).toBe(4);
      expect(await fs.readFile(outFile, "utf8")).toMatch(/it's\r?\n2/u);
    },
    // The first Windows PowerShell on a CI runner takes seconds to start.
    30_000,
  );
});
