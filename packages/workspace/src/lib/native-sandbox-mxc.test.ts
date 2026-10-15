import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { judgeCanary } from "./mxc-canary";
import {
  launchNative,
  mxcFilesystemPolicy,
  mxcRequest,
  type NativeReach,
  windowsCommandLine,
} from "./native-sandbox";
import { reachOf, type Rule } from "./permissions/rules";

const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mxc-policy-")));
afterAll(() => rmSync(base, { force: true, recursive: true }));

/** A home folder on this disk, so the walk for names that run code has one. */
function home(...folders: string[]): string {
  const at = mkdtempSync(path.join(base, "home-"));
  for (const folder of folders) {
    mkdirSync(path.join(at, folder), { recursive: true });
  }
  return at;
}

function reachOver(
  at: string,
  rules: Rule[],
  own: Partial<Pick<NativeReach, "readOnly" | "readWrite">> = {},
  withoutAsking = false,
): NativeReach {
  return {
    readOnly: own.readOnly ?? [],
    readWrite: own.readWrite ?? [],
    rules: { home: at, rules, withoutAsking },
  };
}

/** The disk's root here: `/`, or `C:\` on Windows. */
const ROOT = path.parse(base).root;

/**
 * The policy with the test's folders spelled from `~` and the root as `/`,
 * with `/` between parts, so a snapshot reads the same on every platform.
 */
function policyOf(reach: NativeReach, closed: string[] = []) {
  const policy = mxcFilesystemPolicy(reach, {
    appFolders: [path.join(ROOT, "app")],
    closed: closed.map((folder) => path.join(ROOT, folder)),
    root: ROOT,
  });
  const spell = (listed: string[]) =>
    listed
      .map((each) =>
        (each.startsWith(reach.rules.home)
          ? `~${each.slice(reach.rules.home.length)}`
          : `/${each.slice(ROOT.length)}`
        ).replaceAll("\\", "/"),
      )
      .toSorted();
  return {
    deniedPaths: spell(policy.deniedPaths),
    readonlyPaths: spell(policy.readonlyPaths),
    readwritePaths: spell(policy.readwritePaths),
  };
}

describe("mxcFilesystemPolicy", () => {
  it("reads the disk and the home, then opens and closes each rule's folder", () => {
    const at = home("Documents/work", "Desktop", ".ssh", "chat");
    const reach = reachOver(
      at,
      [
        {
          level: "ask",
          path: path.join(at, "Documents"),
          place: "documents",
          source: "place",
        },
        {
          level: "ask",
          path: path.join(at, "Desktop"),
          place: "desktop",
          source: "place",
        },
        {
          level: "ask",
          path: path.join(at, ".ssh"),
          place: "passwords",
          source: "place",
        },
        {
          level: "allow",
          path: path.join(at, "Documents", "work"),
          source: "grant",
        },
        { level: "readOnly", path: path.join(at, "skills"), source: "system" },
      ],
      { readWrite: [path.join(at, "chat")] },
    );
    expect(policyOf(reach, ["state"])).toMatchInlineSnapshot(`
      {
        "deniedPaths": [
          "/state",
          "~/.ssh",
          "~/Desktop",
          "~/Documents",
        ],
        "readonlyPaths": [
          "/",
          "/app",
          "~",
          "~/skills",
        ],
        "readwritePaths": [
          "~/Documents/work",
          "~/chat",
        ],
      }
    `);
  });

  it("opens every folder that asks under folders-without-asking, but the sign-ins", () => {
    const at = home("Documents", ".ssh");
    const reach = reachOver(
      at,
      [
        {
          level: "ask",
          path: path.join(at, "Documents"),
          place: "documents",
          source: "place",
        },
        {
          level: "ask",
          path: path.join(at, ".ssh"),
          place: "passwords",
          source: "place",
        },
      ],
      {},
      true,
    );
    const policy = policyOf(reach);
    expect(policy.readwritePaths).toEqual(["~/Documents"]);
    expect(policy.deniedPaths).toEqual(["~/.ssh"]);
  });

  it("keeps one entry per path, the highest rank's", () => {
    const at = home("Documents");
    const documents = path.join(at, "Documents");
    const policy = policyOf(
      reachOver(
        at,
        [
          {
            level: "ask",
            path: documents,
            place: "documents",
            source: "place",
          },
          { level: "allow", path: documents, source: "grant" },
        ],
        { readOnly: [documents] },
      ),
    );
    // A grant outranks the place, and the reach's own read-only outranks both.
    expect(policy.readonlyPaths).toContain("~/Documents");
    expect(policy.readwritePaths).not.toContain("~/Documents");
    expect(policy.deniedPaths).not.toContain("~/Documents");
  });

  it("lists each hidden entry for a rule over a folder's hidden entries", () => {
    const at = home(".config", ".cache", "visible");
    const policy = policyOf(
      reachOver(at, [
        {
          dotEntries: true,
          level: "ask",
          path: at,
          place: "appFiles",
          source: "place",
        },
      ]),
    );
    expect(policy.deniedPaths).toEqual(["~/.cache", "~/.config"]);
  });

  it("closes the names that run code already in an allowed folder, and a repository's hooks", () => {
    const at = home("work/repo/.git", "work/.vscode", "other/.vscode");
    const policy = policyOf(
      reachOver(at, [
        { level: "allow", path: path.join(at, "work"), source: "grant" },
      ]),
    );
    expect(policy.readonlyPaths).toEqual(
      expect.arrayContaining(["~/work/.vscode", "~/work/repo/.git/hooks"]),
    );
    expect(policy.readonlyPaths).not.toContain("~/other/.vscode");
  });

  it("does not search the app's own folders for names that run code", () => {
    const at = home("chat/.vscode");
    const chat = path.join(at, "chat");
    const policy = policyOf(
      reachOver(at, [{ level: "allow", path: chat, source: "system" }], {
        readWrite: [chat],
      }),
    );
    expect(policy.readonlyPaths).not.toContain("~/chat/.vscode");
  });

  // The lists say what reachOf says of each rule's folder: a generator that
  // disagrees is the bug, not the rules.
  it("agrees with reachOf at every rule's folder", () => {
    const at = home(
      "Documents/work/deep",
      "Documents/closed",
      "Desktop",
      ".aws",
    );
    const rules: Rule[] = [
      {
        level: "ask",
        path: path.join(at, "Documents"),
        place: "documents",
        source: "place",
      },
      {
        level: "ask",
        path: path.join(at, "Desktop"),
        place: "desktop",
        source: "place",
      },
      {
        level: "never",
        path: path.join(at, ".aws"),
        place: "passwords",
        source: "place",
      },
      {
        level: "allow",
        path: path.join(at, "Documents", "work"),
        source: "folder",
      },
      {
        level: "readOnly",
        path: path.join(at, "Documents", "work", "deep"),
        source: "folder",
      },
      {
        denied: true,
        level: "never",
        path: path.join(at, "Documents", "closed"),
        source: "grant",
      },
    ];
    const reach = reachOver(at, rules);
    const policy = mxcFilesystemPolicy(reach, {
      appFolders: [],
      closed: [],
      root: ROOT,
    });
    for (const rule of rules) {
      const read = reachOf(reach.rules, rule.path, "read").level === "allow";
      const write = reachOf(reach.rules, rule.path, "write").level === "allow";
      const listed = policy.readwritePaths.includes(rule.path)
        ? "write"
        : policy.readonlyPaths.includes(rule.path)
          ? "read"
          : policy.deniedPaths.includes(rule.path)
            ? "deny"
            : "missing";
      expect([rule.path, listed]).toEqual([
        rule.path,
        write ? "write" : read ? "read" : "deny",
      ]);
    }
  });
});

describe("windowsCommandLine", () => {
  it.each([
    [["node", "-e", "1"], "node -e 1"],
    [["C:\\Program Files\\x.exe", "a b"], '"C:\\Program Files\\x.exe" "a b"'],
    [["x", ""], 'x ""'],
    [["x", 'say "hi"'], 'x "say \\"hi\\""'],
    [["x", "C:\\a b\\"], 'x "C:\\a b\\\\"'],
    [["x", 'a\\"b'], 'x "a\\\\\\"b"'],
    [["x", "no\\space\\"], "x no\\space\\"],
  ])("quotes %j as %s", (argv, line) => {
    expect(windowsCommandLine(argv)).toBe(line);
  });

  it("joins a verbatim line as given", () => {
    expect(windowsCommandLine(["cmd.exe", "/d", "/s", '/c "a b"'], true)).toBe(
      'cmd.exe /d /s /c "a b"',
    );
  });
});

describe("mxcRequest", () => {
  it("asks for Tier 1 with UI on, the network open and exactly the environment given", () => {
    expect(
      mxcRequest({
        commandLine: "node -e 1",
        cwd: "C:\\work",
        env: { PATH: "C:\\bin", SYSTEMROOT: "C:\\Windows", UNSET: undefined },
        filesystem: {
          deniedPaths: [],
          readonlyPaths: ["C:\\"],
          readwritePaths: ["C:\\work"],
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "containment": "processcontainer",
        "fallback": {
          "allowDaclMutation": false,
        },
        "filesystem": {
          "deniedPaths": [],
          "readonlyPaths": [
            "C:\\",
          ],
          "readwritePaths": [
            "C:\\work",
          ],
        },
        "network": {
          "egress": {
            "default": "allow",
          },
          "ingress": {
            "default": "allow",
            "hostLoopback": "allow",
          },
        },
        "process": {
          "commandLine": "node -e 1",
          "cwd": "C:\\work",
          "env": [
            "PATH=C:\\bin",
            "SYSTEMROOT=C:\\Windows",
          ],
          "timeout": 0,
        },
        "ui": {
          "disable": false,
        },
        "version": "1.0.0",
      }
    `);
  });
});

describe("launchNative", () => {
  const filesystem = {
    deniedPaths: [],
    readonlyPaths: ["/"],
    readwritePaths: [],
  };

  it("leaves a command no MXC holds as it was wrapped", () => {
    expect(
      launchNative(
        { args: ["-p", "x", "/bin/ls"], file: "/usr/bin/sandbox-exec" },
        { env: {} },
      ),
    ).toEqual({ args: ["-p", "x", "/bin/ls"], file: "/usr/bin/sandbox-exec" });
  });

  it("hands the launcher the request with the working folder and environment", () => {
    const launch = launchNative(
      {
        args: [],
        file: "wxc-exec.exe",
        mxc: { argv: ["node", "a b"], filesystem },
      },
      {
        cwd: "/work",
        env: { SYSTEMROOT: "C:\\Windows" },
        windowsVerbatimArguments: false,
      },
    );
    expect(launch.file).toBe("wxc-exec.exe");
    expect(launch.args[0]).toBe("--config-base64");
    const request = JSON.parse(
      Buffer.from(launch.args[1] ?? "", "base64").toString("utf8"),
    ) as ReturnType<typeof mxcRequest>;
    expect(request.process).toEqual({
      commandLine: 'node "a b"',
      cwd: "/work",
      env: ["SYSTEMROOT=C:\\Windows"],
      timeout: 0,
    });
  });

  it("writes a request too long for a command line to the sandbox's folder", () => {
    const launch = launchNative(
      { args: [], file: "wxc-exec.exe", mxc: { argv: ["node"], filesystem } },
      { cwd: "/work", env: { BIG: "x".repeat(40_000) } },
    );
    expect(launch.args[0]).toBe("--config");
    const file = launch.args[1] ?? "";
    expect(path.basename(path.dirname(path.dirname(file)))).toBe("sandbox");
    expect(
      (JSON.parse(readFileSync(file, "utf8")) as ReturnType<typeof mxcRequest>)
        .process.cwd,
    ).toBe("/work");
  });
});

describe("judgeCanary", () => {
  const expected = {
    escaped: false,
    expectedPath: "C:\\c\\granted\\canary.txt",
    token: "t0k",
  };
  const passing = {
    closed: { error: "EPERM" },
    escape: { error: "EPERM" },
    read: "t0k",
    real: "C:\\c\\granted\\canary.txt",
  };

  it("passes when all three hold", () => {
    expect(judgeCanary(JSON.stringify(passing), expected)).toEqual({
      kind: "works",
    });
  });

  it.each([
    [
      "a granted file that did not read",
      { read: { error: "EPERM" } },
      {},
      "a granted file did not read",
    ],
    [
      "a realpath refused, as #1464 refused it",
      { real: { error: "EPERM" } },
      {},
      "drive-letter",
    ],
    [
      "a realpath in NT form",
      { real: "\\Device\\HarddiskVolume3\\c\\granted\\canary.txt" },
      {},
      "drive-letter",
    ],
    [
      "a closed folder that read",
      { closed: "read" },
      {},
      "closed folder could be read",
    ],
    [
      "a write the program says it made",
      { escape: "wrote" },
      {},
      "nothing grants could be written",
    ],
    [
      "a write found on the disk afterwards",
      {},
      { escaped: true },
      "nothing grants could be written",
    ],
  ])("fails on %s", (_, printed, found, reason) => {
    const verdict = judgeCanary(JSON.stringify({ ...passing, ...printed }), {
      ...expected,
      ...found,
    });
    expect(verdict.kind).toBe("fails");
    expect(verdict.kind === "fails" && verdict.reason).toContain(reason);
  });

  it("fails on output that is not the canary's", () => {
    expect(judgeCanary("STATUS_DLL_INIT_FAILED", expected).kind).toBe("fails");
  });
});
