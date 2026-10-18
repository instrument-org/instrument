import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Disk, liveDisk } from "./disk";
import { mxcPolicyFor } from "./mxc";
import { judgeCanary } from "./mxc-canary";
import {
  launchNative,
  mxcFilesystemPolicy,
  mxcRequest,
  type NativeReach,
  windowsCommandLine,
} from "./index";
import { reachOf, type Rule } from "../permissions/rules";
import { AbsolutePathSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";

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
  dangerouslyAllowEveryFolder = false,
): NativeReach {
  return {
    readOnly: own.readOnly ?? [],
    readWrite: own.readWrite ?? [],
    rules: { home: at, rules, dangerouslyAllowEveryFolder },
  };
}

/** The disk's root here: `/`, or `C:\` on Windows. */
const ROOT = path.parse(base).root;

/**
 * The policy with the test's home spelled `~`, the app's folders (made
 * beside it) `<app>`, and the root `/`, with `/` between parts, so a
 * snapshot reads the same on every platform.
 */
function policyOf(reach: NativeReach, closed: string[] = []) {
  const app = path.join(base, "app");
  mkdirSync(path.join(app, "bin"), { recursive: true });
  for (const folder of closed) {
    mkdirSync(path.join(app, folder), { recursive: true });
  }
  const policy = mxcFilesystemPolicy(reach, {
    appFolders: [path.join(app, "bin")],
    closed: closed.map((folder) => path.join(app, folder)),
    root: ROOT,
  });
  const spell = (listed: string[]) =>
    listed
      .map((each) =>
        (each.startsWith(reach.rules.home)
          ? `~${each.slice(reach.rules.home.length)}`
          : each.startsWith(app)
            ? `<app>${each.slice(app.length)}`
            : `/${each.slice(ROOT.length)}`
        ).replaceAll("\\", "/"),
      )
      .toSorted();
  return {
    deniedPaths: spell(policy.deniedPaths),
    // What is above the test's home depends on the host's temp folder.
    enumeratePaths: spell(
      policy.enumeratePaths.filter(
        (folder) =>
          folder.startsWith(reach.rules.home) || folder.startsWith(app),
      ),
    ),
    readonlyPaths: spell(policy.readonlyPaths),
    readwritePaths: spell(policy.readwritePaths),
  };
}

describe("mxcFilesystemPolicy", () => {
  it("reads the disk and the home, then opens and closes each rule's folder", () => {
    const at = home("Documents/work", "Desktop", ".ssh", "chat", "skills");
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
          "<app>/state",
          "~/.ssh",
          "~/Desktop",
        ],
        "enumeratePaths": [
          "~/Documents",
        ],
        "readonlyPaths": [
          "/",
          "<app>/bin",
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
    // What the deepest listed folder at or above `folder` gives it.
    const listedAt = (folder: string): string => {
      for (let above = folder; ; above = path.dirname(above)) {
        if (policy.readwritePaths.includes(above)) {
          return "write";
        }
        if (policy.readonlyPaths.includes(above)) {
          return "read";
        }
        // A folder listed to look at is read in no more than a denied one.
        if (
          policy.deniedPaths.includes(above) ||
          policy.enumeratePaths.includes(above) ||
          above === path.dirname(above)
        ) {
          return "deny";
        }
      }
    };
    for (const rule of rules) {
      const read = reachOf(reach.rules, rule.path, "read").level === "allow";
      const write = reachOf(reach.rules, rule.path, "write").level === "allow";
      const listed = listedAt(rule.path);
      expect([rule.path, listed]).toEqual([
        rule.path,
        write ? "write" : read ? "read" : "deny",
      ]);
    }
  });
});

describe("mxcFilesystemPolicy's missing paths", () => {
  it("keeps one only where it could be made", () => {
    const at = home("work");
    const policy = policyOf(
      reachOver(at, [
        {
          level: "never",
          path: path.join(at, ".aws"),
          place: "passwords",
          source: "place",
        },
        { level: "allow", path: path.join(at, "work"), source: "grant" },
        {
          denied: true,
          level: "never",
          path: path.join(at, "work", "later"),
          source: "grant",
        },
      ]),
    );
    expect(policy.deniedPaths).toEqual(["~/work/later"]);
  });
});

describe("mxcFilesystemPolicy's folders to look at", () => {
  it("are a folder closed by name with an open one below it, and each folder on the way", () => {
    const at = home("AppData/Local/Temp/chat");
    const appData = path.join(at, "AppData");
    const chat = path.join(appData, "Local", "Temp", "chat");
    const policy = mxcFilesystemPolicy(
      reachOver(
        at,
        [{ level: "ask", path: appData, place: "appFiles", source: "place" }],
        { readWrite: [chat] },
      ),
      { appFolders: [], closed: [], root: ROOT },
    );
    // Denied by name, it would break git and PowerShell in the chat.
    expect(policy.deniedPaths).toEqual([]);
    // What is above the test's home depends on the host's temp folder.
    expect(
      policy.enumeratePaths.filter((folder) => folder.startsWith(at)),
    ).toEqual([
      appData,
      path.join(appData, "Local"),
      path.join(appData, "Local", "Temp"),
    ]);
  });

  it("leave a closed folder with nothing open below it denied by name", () => {
    const at = home("Documents/probe", "Desktop/inside");
    const asks = (folder: string): Rule => ({
      level: "ask",
      path: path.join(at, folder),
      place: "documents",
      source: "place",
    });
    const policy = policyOf(
      reachOver(at, [
        asks("Documents"),
        asks("Desktop"),
        {
          level: "allow",
          path: path.join(at, "Documents", "probe"),
          source: "grant",
        },
      ]),
    );
    expect(policy.deniedPaths).toEqual(["~/Desktop"]);
    expect(policy.enumeratePaths).toEqual(["~/Documents"]);
  });

  it("leave out a denied folder inside a denied one with nothing open below", () => {
    const at = home("AppData/Roaming/Instrument/machine");
    const appData = path.join(at, "AppData");
    const data = path.join(appData, "Roaming", "Instrument");
    const policy = policyOf(
      reachOver(at, [
        { level: "ask", path: appData, place: "appFiles", source: "place" },
        { appData: true, level: "never", path: data, source: "system" },
        {
          appData: true,
          level: "never",
          path: path.join(data, "machine"),
          source: "system",
        },
      ]),
    );
    expect(policy.deniedPaths).toEqual(["~/AppData"]);
    expect(policy.enumeratePaths).toEqual([]);
  });

  it("list the app's data folder and the runtime folder in it on the way to the runtime's caches", () => {
    // The app's data folder under AppData, closed, with the runtime folder
    // in it closed too and its caches open. The sandbox's own folder beside
    // the caches stays denied by name, so its names do not show.
    const at = home("AppData/Roaming/Instrument/runtime/caches");
    const appData = path.join(at, "AppData");
    const data = path.join(appData, "Roaming", "Instrument");
    const runtime = path.join(data, "runtime");
    const appDataRule = (folder: string): Rule => ({
      appData: true,
      level: "never",
      path: folder,
      source: "system",
    });
    const policy = mxcFilesystemPolicy(
      reachOver(
        at,
        [
          { level: "ask", path: appData, place: "appFiles", source: "place" },
          appDataRule(data),
          appDataRule(runtime),
        ],
        { readWrite: [path.join(runtime, "caches")] },
      ),
      {
        appFolders: [],
        closed: [path.join(runtime, "sandbox")],
        root: ROOT,
      },
    );
    const spell = (listed: string[]) =>
      listed
        .filter((folder) => folder.startsWith(at))
        .map((folder) => `~${folder.slice(at.length)}`.replaceAll("\\", "/"));
    expect({
      deniedPaths: spell(policy.deniedPaths),
      enumeratePaths: spell(policy.enumeratePaths),
      readwritePaths: spell(policy.readwritePaths),
    }).toMatchInlineSnapshot(`
      {
        "deniedPaths": [
          "~/AppData/Roaming/Instrument/runtime/sandbox",
        ],
        "enumeratePaths": [
          "~/AppData",
          "~/AppData/Roaming",
          "~/AppData/Roaming/Instrument",
          "~/AppData/Roaming/Instrument/runtime",
        ],
        "readwritePaths": [
          "~/AppData/Roaming/Instrument/runtime/caches",
        ],
      }
    `);
  });
});

describe("mxcFilesystemPolicy over a chat's real layout", () => {
  it("lists only the way to the chat's own folders, and denies by name what is off it", () => {
    // As the app lays it out on Windows: the app's data under
    // `AppData\Roaming`, every workspace's chats' work in `~/.instrument`,
    // a grant inside Documents, which asks first, and the places in
    // `AppData` whose names say what the person has been doing.
    const at = home(
      ".instrument/work/instrument-abcd/2026-10-13-chat",
      ".instrument/work/instrument-abcd/2026-10-13-other",
      ".instrument/work/taxes-wxyz/2026-10-13-chat",
      "AppData/Local/Packages",
      "AppData/Local/Programs",
      "AppData/Local/Microsoft/Credentials",
      "AppData/Roaming/Microsoft/Windows/Recent/AutomaticDestinations",
      "AppData/Roaming/Instrument/machine/default/keys",
      "AppData/Roaming/Instrument/runtime/caches",
      "AppData/Roaming/Instrument/runtime/sandbox",
      "AppData/Roaming/Instrument/workspace/.instrument/chats/2026-10-13-chat/attachments",
      "AppData/Roaming/Instrument/workspace/.instrument/chats/2026-10-13-other/attachments",
      "Documents/probe",
      "Documents/taxes",
    );
    const data = path.join(at, "AppData", "Roaming", "Instrument");
    const work = path.join(at, ".instrument", "work", "instrument-abcd");
    const chat = path.join(work, "2026-10-13-chat");
    const records = path.join(data, "workspace", ".instrument");
    const record = path.join(records, "chats", "2026-10-13-chat");
    const appData = (folder: string): Rule => ({
      appData: true,
      level: "never",
      path: folder,
      source: "system",
    });
    const policy = policyOf(
      reachOver(
        at,
        [
          {
            level: "ask",
            path: path.join(at, "AppData"),
            place: "appFiles",
            source: "place",
          },
          {
            level: "ask",
            path: path.join(at, "Documents"),
            place: "documents",
            source: "place",
          },
          {
            level: "never",
            path: path.join(at, "AppData", "Roaming", "Microsoft", "Windows", "Recent"),
            place: "appFiles",
            source: "place",
          },
          {
            level: "never",
            path: path.join(at, "AppData", "Local", "Microsoft", "Credentials"),
            place: "passwords",
            source: "place",
          },
          {
            level: "allow",
            path: path.join(at, "Documents", "probe"),
            source: "grant",
          },
          appData(data),
          appData(path.join(data, "machine", "default")),
          appData(path.join(data, "runtime")),
          appData(records),
          appData(path.join(at, ".instrument")),
          { level: "allow", path: chat, source: "system" },
          {
            level: "readOnly",
            path: path.join(record, "attachments"),
            source: "system",
          },
          {
            level: "allow",
            path: path.join(at, "AppData", "Local", "Packages"),
            source: "system",
          },
          {
            level: "readOnly",
            path: path.join(at, "AppData", "Local", "Programs"),
            source: "system",
          },
        ],
        { readWrite: [chat, path.join(data, "runtime", "caches")] },
      ),
    );
    expect(policy).toMatchInlineSnapshot(`
      {
        "deniedPaths": [
          "~/.instrument/work/instrument-abcd/2026-10-13-other",
          "~/.instrument/work/taxes-wxyz",
          "~/AppData/Local/Microsoft/Credentials",
          "~/AppData/Roaming/Instrument/machine",
          "~/AppData/Roaming/Instrument/runtime/sandbox",
          "~/AppData/Roaming/Instrument/workspace/.instrument",
          "~/AppData/Roaming/Microsoft/Windows/Recent",
        ],
        "enumeratePaths": [
          "~/.instrument",
          "~/.instrument/work",
          "~/.instrument/work/instrument-abcd",
          "~/AppData",
          "~/AppData/Local",
          "~/AppData/Roaming",
          "~/AppData/Roaming/Instrument",
          "~/AppData/Roaming/Instrument/runtime",
          "~/AppData/Roaming/Instrument/workspace",
          "~/AppData/Roaming/Instrument/workspace/.instrument/chats",
          "~/AppData/Roaming/Instrument/workspace/.instrument/chats/2026-10-13-chat",
          "~/Documents",
        ],
        "readonlyPaths": [
          "/",
          "<app>/bin",
          "~",
          "~/AppData/Local/Programs",
          "~/AppData/Roaming/Instrument/workspace/.instrument/chats/2026-10-13-chat/attachments",
        ],
        "readwritePaths": [
          "~/.instrument/work/instrument-abcd/2026-10-13-chat",
          "~/AppData/Local/Packages",
          "~/AppData/Roaming/Instrument/runtime/caches",
          "~/Documents/probe",
        ],
      }
    `);
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
          deniedPaths: ["C:\\Users\\sam\\AppData"],
          enumeratePaths: ["C:\\Users\\sam\\AppData"],
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
          "deniedPaths": [
            "C:\\Users\\sam\\AppData",
          ],
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
        "processContainer": {
          "filesystem": {
            "enumeratePaths": [
              "C:\\Users\\sam\\AppData",
            ],
          },
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
    enumeratePaths: [],
    readonlyPaths: ["/"],
    readwritePaths: [],
  };
  const reach = reachOver(base, []);

  it("leaves a command no MXC holds as it was wrapped", () => {
    expect(
      launchNative(
        {
          args: ["-p", "x", "/bin/ls"],
          file: "/usr/bin/sandbox-exec",
          kind: "sandboxed",
          reach,
        },
        { env: {} },
      ),
    ).toEqual({ args: ["-p", "x", "/bin/ls"], file: "/usr/bin/sandbox-exec" });
  });

  it("hands the launcher the request with the working folder and environment", () => {
    const launch = launchNative(
      {
        argv: ["node", "a b"],
        file: "wxc-exec.exe",
        filesystem,
        kind: "mxc",
        reach,
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

  describe("with uutils to start the program", () => {
    const uutils = path.join(base, "uutils");
    const coreutils = path.join(uutils, "coreutils.exe");
    const temp = "C:\\Users\\sam\\AppData\\Local\\Temp";
    let config: ReturnType<typeof getWorkspaceConfig>;
    beforeAll(() => {
      mkdirSync(uutils, { recursive: true });
      writeFileSync(coreutils, "");
      config = getWorkspaceConfig();
      setWorkspaceConfig({
        ...config,
        uutilsDir: AbsolutePathSchema.parse(uutils),
      });
    });
    afterAll(() => setWorkspaceConfig(config));

    function commandLine(
      argv: string[],
      env: Record<string, string>,
      verbatim = false,
    ) {
      const launch = launchNative(
        { argv, file: "wxc-exec.exe", filesystem, kind: "mxc", reach },
        { env, windowsVerbatimArguments: verbatim },
      );
      return (
        JSON.parse(
          Buffer.from(launch.args[1] ?? "", "base64").toString("utf8"),
        ) as ReturnType<typeof mxcRequest>
      ).process.commandLine;
    }

    it("gives the program back the temp folder Windows moves into the container", () => {
      expect(
        commandLine(["python.exe", "-c", "print(1)"], {
          TEMP: temp,
          TMP: temp,
        }),
      ).toBe(
        windowsCommandLine([
          coreutils,
          "env",
          `TEMP=${temp}`,
          `TMP=${temp}`,
          "python.exe",
          "-c",
          "print(1)",
        ]),
      );
    });

    it.each([
      ["a cmd.exe line", ["cmd.exe", "/d", "/s", '/c "a b"'], true],
      ["a batch file", ["C:\\tools\\npx.cmd", "x"], false],
    ])("leaves %s as it is", (_, argv, verbatim) => {
      expect(commandLine(argv, { TEMP: temp }, verbatim)).toBe(
        windowsCommandLine(argv, verbatim),
      );
    });

    it("leaves a program with no temp folder to give as it is", () => {
      expect(commandLine(["node", "a b"], {})).toBe('node "a b"');
    });
  });

  it("writes a request too long for a command line to the sandbox's folder", () => {
    const launch = launchNative(
      {
        argv: ["node"],
        file: "wxc-exec.exe",
        filesystem,
        kind: "mxc",
        reach,
      },
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

describe("mxcPolicyFor", () => {
  /** Long after every folder here changed, so each stamp is settled. */
  const later = () => Date.now() + 60_000;

  /** The live disk, counting the folders it lists. */
  function countingDisk() {
    const counted = { lists: 0 };
    const disk: Disk = {
      ...liveDisk,
      list: (folder) => {
        counted.lists += 1;
        return liveDisk.list(folder);
      },
    };
    return { counted, disk };
  }

  /** A home with a projects folder the rules allow, and a chat folder. */
  function projects(...folders: string[]) {
    const at = home("Projects/app", ...folders.map((f) => `Projects/${f}`));
    const reach = reachOver(
      at,
      [{ level: "allow", path: path.join(at, "Projects"), source: "folder" }],
      { readWrite: [path.join(at, "chat")] },
    );
    return { at, reach };
  }

  const inputs = { appFolders: [], closed: [], root: ROOT };

  it("gives a second command the policy the first one built", () => {
    const { reach } = projects();
    const { counted, disk } = countingDisk();
    const first = mxcPolicyFor(reach, { ...inputs, disk, now: later() });
    const listed = counted.lists;
    expect(listed).toBeGreaterThan(0);
    expect(mxcPolicyFor(reach, { ...inputs, disk, now: later() })).toBe(first);
    expect(counted.lists).toBe(listed);
  });

  it.each([
    [".git", ".git/hooks"],
    [".vscode", ".vscode"],
    ["deep/.git", "deep/.git/hooks"],
  ])("builds again once %s is made in an allowed folder", (made, held) => {
    const { at, reach } = projects("app/deep");
    const first = mxcPolicyFor(reach, { ...inputs, now: later() });
    const target = path.join(at, "Projects", "app", held);
    expect(first.readonlyPaths).not.toContain(target);
    mkdirSync(path.join(at, "Projects", "app", made), { recursive: true });
    const next = mxcPolicyFor(reach, { ...inputs, now: later() });
    expect(next).not.toBe(first);
    expect(next.readonlyPaths).toContain(target);
  });

  it("builds again once a name of two parts is made in its folder", () => {
    const { at, reach } = projects("app/.claude");
    const settings = path.join(
      at,
      "Projects",
      "app",
      ".claude",
      "settings.json",
    );
    expect(
      mxcPolicyFor(reach, { ...inputs, now: later() }).readonlyPaths,
    ).not.toContain(settings);
    writeFileSync(settings, "{}");
    expect(
      mxcPolicyFor(reach, { ...inputs, now: later() }).readonlyPaths,
    ).toContain(settings);
  });

  it("builds again for changed rules", () => {
    const { at, reach } = projects("secret");
    const first = mxcPolicyFor(reach, { ...inputs, now: later() });
    const secret = path.join(at, "Projects", "secret");
    expect(first.deniedPaths).not.toContain(secret);
    const closed = {
      ...reach,
      rules: {
        ...reach.rules,
        rules: [
          ...reach.rules.rules,
          { level: "never", path: secret, source: "folder" } satisfies Rule,
        ],
      },
    };
    expect(
      mxcPolicyFor(closed, { ...inputs, now: later() }).deniedPaths,
    ).toContain(secret);
    // The first rules' policy is still the one they built.
    expect(mxcPolicyFor(reach, { ...inputs, now: later() })).toBe(first);
  });

  it("makes the chat's folder again once it is gone", () => {
    const { at, reach } = projects();
    const chat = path.join(at, "chat");
    mxcPolicyFor(reach, { ...inputs, now: later() });
    rmSync(chat, { force: true, recursive: true });
    expect(
      mxcPolicyFor(reach, { ...inputs, now: later() }).readwritePaths,
    ).toContain(chat);
    expect(existsSync(chat)).toBe(true);
  });

  it("builds again while a folder it read has just changed", () => {
    const { reach } = projects();
    const { counted, disk } = countingDisk();
    mxcPolicyFor(reach, { ...inputs, disk, now: Date.now() });
    const listed = counted.lists;
    mxcPolicyFor(reach, { ...inputs, disk, now: Date.now() });
    expect(counted.lists).toBe(listed * 2);
  });
});
