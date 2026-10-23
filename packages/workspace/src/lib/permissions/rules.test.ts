import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { SYSTEM_DRIVE } from "../disk-root";
import { folderToAskFor, reachOf, type Rules, rulesFor } from "./rules";

// A home folder on the drive this computer runs from, spelled as node:path
// spells one here (`C:\Users\someone` on Windows), so a folder the rules name
// compares as is. The drive is named rather than left to `resolve`, which
// takes the drive the run happens to be on: a machine whose temp folder or
// checkout is on another drive would put this home inside the drives place,
// which asks, and every case below that reads a path no rule covers would
// read as asking instead.
const home = nodePath.join(
  process.platform === "win32" ? `${SYSTEM_DRIVE}\\` : "/",
  "Users",
  "someone",
);
const inHome = (relative: string) => nodePath.join(home, relative);
const settings = {
  apps: [],
  chats: {},
  topics: {},
  folders: [],
  places: {},
  dangerouslyAllowEveryFolder: false,
};

describe.runIf(process.platform === "darwin")("reachOf on a Mac", () => {
  const rules = rulesFor({
    grants: [
      {
        grantedAt: new Date(0),
        path: AbsolutePathSchema.parse(`${home}/Documents/Clients/Acme`),
        source: "card",
      },
    ],
    home,
    settings: {
      ...settings,
      folders: [
        {
          addedAt: new Date(0),
          level: "never",
          path: AbsolutePathSchema.parse(
            `${home}/Documents/Clients/Acme/Payroll`,
          ),
        },
      ],
    },
  });

  it.each([
    ["read", `${home}/Projects/notes.md`, "allow"],
    ["write", `${home}/Projects/notes.md`, "ask"],
    ["read", `${home}/Documents/Clients/Other/contract.pdf`, "ask"],
    ["write", `${home}/Documents/Clients/Acme/brief.md`, "allow"],
    ["read", `${home}/Documents/Clients/Acme/Payroll/june.csv`, "never"],
    ["read", `${home}/.ssh/id_ed25519`, "ask"],
    ["read", `${home}/.netrc`, "ask"],
    ["read", `${home}/Library/Keychains/login.keychain-db`, "never"],
    ["read", `${home}/Library/Application Support/Arc/User Data`, "never"],
    // A hidden folder in the home folder that no sign-in list names is read
    // without a card, and changed only after one.
    ["read", `${home}/.config/uv/uv.toml`, "allow"],
    ["write", `${home}/.config/uv/uv.toml`, "ask"],
    ["read", `${home}/.m2/settings.xml`, "ask"],
    ["read", `${home}/Library/Preferences/x.plist`, "ask"],
    // The output folder, which is the home folder's `Instrument` while
    // nobody has picked one; Documents around it still asks.
    ["write", `${home}/Instrument/out.png`, "allow"],
    ["write", `${home}/Documents/Instrument/out.png`, "ask"],
    ["read", "/Volumes/Backup/photos", "ask"],
    ["read", "/usr/bin/env", "allow"],
    ["write", "/opt/thing", "ask"],
  ] as const)("%s %s is %s", (op, target, level) => {
    expect(reachOf(rules, target, op).level).toBe(level);
  });

  it.each([
    ["read", `/System/Volumes/Data${home}/.ssh/id_ed25519`, "ask"],
    [
      "read",
      `/system/volumes/data${home}/Documents/Clients/Other/a.pdf`,
      "ask",
    ],
    [
      "read",
      `/System/Volumes/Data${home}/Documents/Clients/Acme/Payroll/june.csv`,
      "never",
    ],
    [
      "write",
      `/System/Volumes/Data${home}/Documents/Clients/Acme/brief.md`,
      "allow",
    ],
    ["write", `/System/Volumes/Data${home}/notes.md`, "ask"],
  ] as const)("%s %s by its Data-volume path is %s", (op, target, level) => {
    expect(reachOf(rules, target, op).level).toBe(level);
  });

  it("turns asks into allows without asking but sign-ins', never never", () => {
    const relaxed = { ...rules, dangerouslyAllowEveryFolder: true };
    expect(reachOf(relaxed, `${home}/Desktop/a.png`, "write").level).toBe(
      "allow",
    );
    expect(reachOf(relaxed, `${home}/.aws/credentials`, "read").level).toBe(
      "ask",
    );
    expect(
      reachOf(relaxed, `${home}/Library/Cookies/Cookies.binarycookies`, "read")
        .level,
    ).toBe("never");
    // A change no rule holds still asks, as the native profiles keep it.
    expect(reachOf(relaxed, `${home}/newproj/a.txt`, "write").level).toBe(
      "ask",
    );
    expect(reachOf(relaxed, "/opt/thing", "write").level).toBe("ask");
  });

  it.each([
    ["allow", "allow", "allow"],
    ["never", "never", "never"],
    ["ask", "ask", "never"],
  ] as const)(
    "with the passwords place set to %s, sign-ins are %s and the Keychain %s",
    (place, signIns, keychain) => {
      const changed = rulesFor({
        home,
        settings: { ...settings, places: { passwords: place } },
      });
      expect(reachOf(changed, `${home}/.ssh/config`, "read").level).toBe(
        signIns,
      );
      expect(
        reachOf(changed, `${home}/Library/Keychains/x.keychain-db`, "read")
          .level,
      ).toBe(keychain);
    },
  );

  it("lets a grant open a sign-in folder", () => {
    const granted = rulesFor({
      grants: [
        {
          grantedAt: new Date(0),
          path: AbsolutePathSchema.parse(`${home}/.ssh`),
          source: "card",
        },
      ],
      home,
      settings,
    });
    expect(reachOf(granted, `${home}/.ssh/id_ed25519`, "read").level).toBe(
      "allow",
    );
    expect(reachOf(granted, `${home}/.gnupg/pubring.kbx`, "read").level).toBe(
      "ask",
    );
  });

  it("holds a not now over Use folders without asking", () => {
    const declined = rulesFor({
      denials: [`${home}/Desktop/Trip`],
      home,
      settings: { ...settings, dangerouslyAllowEveryFolder: true },
    });
    const reach = reachOf(declined, `${home}/Desktop/Trip/a.png`, "read");
    expect(reach.level).toBe("never");
    expect(reach.rule?.denied).toBe(true);
    expect(reachOf(declined, `${home}/Desktop/b.png`, "read").level).toBe(
      "allow",
    );
  });

  // Always on a card for Desktop sets the place; for a folder in it, or on
  // a place of several folders, it writes a folder rule.
  it.each([
    [
      "a folder rule",
      {
        folders: [
          {
            addedAt: new Date(0),
            level: "allow",
            path: AbsolutePathSchema.parse(`${home}/Desktop/Trip`),
          } as const,
        ],
      },
    ],
    ["the place", { places: { desktop: "allow" } } as const],
  ])("lets an Always allow on %s outrank a not now", (_on, always) => {
    const allowedLater = rulesFor({
      denials: [`${home}/Desktop/Trip`],
      home,
      settings: { ...settings, ...always },
    });
    expect(
      reachOf(allowedLater, `${home}/Desktop/Trip/a.png`, "read").level,
    ).toBe("allow");
  });
});

describe("folderToAskFor", () => {
  const documents = {
    level: "ask",
    path: inHome("Documents"),
    source: "place",
  } as const;

  it.each([
    [
      inHome("Documents/Clients/Acme/a.pdf"),
      false,
      inHome("Documents/Clients"),
    ],
    [inHome("Documents/report.pdf"), false, inHome("Documents")],
    [inHome("Documents/Clients"), true, inHome("Documents/Clients")],
  ])("%s asks for %s", (hostPath, isDirectory, expected) => {
    expect(
      folderToAskFor({
        hostPath,
        isDirectory,
        rule: documents,
        rules: rulesFor({ home, settings }),
      }),
    ).toBe(expected);
  });

  it.each([
    [inHome(".ssh/config"), inHome(".ssh")],
    [inHome(".ssh/keys/work/id_ed25519"), inHome(".ssh")],
    [inHome(".config/gh/hosts.yml"), inHome(".config/gh")],
    [inHome(".netrc"), inHome(".netrc")],
    [inHome(".docker/config.json"), inHome(".docker/config.json")],
  ])("asks for a sign-in place whole: %s asks for %s", (hostPath, expected) => {
    const rules = rulesFor({ home, settings });
    expect(
      folderToAskFor({
        hostPath,
        isDirectory: false,
        rule: reachOf(rules, hostPath, "read").rule,
        rules,
      }),
    ).toBe(expected);
  });

  it("asks one level below home where no rule holds the path", () => {
    expect(
      folderToAskFor({
        hostPath: inHome("Projects/site/index.html"),
        isDirectory: false,
        rule: undefined,
        rules: rulesFor({ home, settings }),
      }),
    ).toBe(inHome("Projects"));
  });

  // A home on a drive the drives place asks about, or under a folder rule
  // the person set: one level below that rule is the home folder, or a
  // folder holding it.
  it.each([
    [inHome("Music/Loops"), inHome("Music"), true],
    [inHome("notes.md"), home, false],
    [home, home, true],
  ])(
    "asks from the home folder down under a rule holding it: %s asks for %s",
    (hostPath, expected, isDirectory) => {
      expect(
        folderToAskFor({
          hostPath,
          isDirectory,
          rule: {
            level: "ask",
            path: nodePath.dirname(nodePath.dirname(home)),
            source: "folder",
          },
          rules: rulesFor({ home, settings }),
        }),
      ).toBe(expected);
    },
  );

  // The app's own data in a place that asks, as this computer's folder sits
  // in the Library on a Mac: a card for something beside it names the folder
  // below the one that holds it, and one with nothing below asks for the
  // folder that holds it, which ruleRefusal names nothing to ask for.
  it.each([
    [
      inHome("Library/Application Support/Other/state.json"),
      false,
      inHome("Library/Application Support/Other"),
    ],
    [
      inHome("Library/Application Support/Other/cache/a"),
      true,
      inHome("Library/Application Support/Other"),
    ],
    [
      inHome("Library/Application Support"),
      true,
      inHome("Library/Application Support"),
    ],
    [
      inHome("Library/Preferences/x.plist"),
      false,
      inHome("Library/Preferences"),
    ],
  ])(
    "asks around the app's own data: %s asks for %s",
    (hostPath, isDirectory, expected) => {
      const base = rulesFor({ home, settings });
      const rules = {
        ...base,
        rules: [
          ...base.rules,
          {
            appData: true,
            level: "never",
            path: inHome("Library/Application Support/Instrument"),
            source: "system",
          } as const,
        ],
      };
      expect(
        folderToAskFor({
          hostPath,
          isDirectory,
          rule: { level: "ask", path: inHome("Library"), source: "place" },
          rules,
        }),
      ).toBe(expected);
    },
  );
});

// One app's folder, the first below the folders that hold a folder per app.
describe("folderToAskFor in App files", () => {
  const cases: Partial<Record<NodeJS.Platform, [string, string][]>> = {
    darwin: [
      [
        "Library/Application Support/Code/User/settings.json",
        "Library/Application Support/Code",
      ],
      ["Library/Containers/com.foo/Data/a.db", "Library/Containers/com.foo"],
      ["Library/Logs/Foo/a.log", "Library/Logs/Foo"],
      ["Library/Preferences/com.foo.plist", "Library/Preferences"],
    ],
    linux: [
      [".config/Code/User/settings.json", ".config/Code"],
      [".local/share/fonts/a.ttf", ".local/share/fonts"],
    ],
    win32: [
      ["AppData/Roaming/discord/settings.json", "AppData/Roaming/discord"],
      ["AppData/Local/Foo/a.db", "AppData/Local/Foo"],
      [
        "AppData/Local/Packages/Foo_1/LocalState/a",
        "AppData/Local/Packages/Foo_1",
      ],
    ],
  };

  it.each(cases[process.platform] ?? [])("%s asks for %s", (file, folder) => {
    const rules = rulesFor({ home, settings });
    const hostPath = inHome(file);
    const { rule } = reachOf(rules, hostPath, "read");
    expect(rule?.place).toBe("appFiles");
    expect(folderToAskFor({ hostPath, isDirectory: false, rule, rules })).toBe(
      inHome(folder),
    );
  });
});

describe.runIf(process.platform !== "win32")("an allow above the home", () => {
  const plantedHome = "/scratch/run/home";
  const base = rulesFor({ home: plantedHome, settings });
  const rules = {
    ...base,
    rules: [
      ...base.rules,
      { level: "allow", path: "/scratch", source: "system" } as const,
    ],
  };

  it.each([
    ["write", "/scratch/notes.md", "allow"],
    ["read", `${plantedHome}/notes.md`, "allow"],
    ["write", `${plantedHome}/notes.md`, "ask"],
    ["write", `${plantedHome}/Documents/a.md`, "ask"],
  ] as const)("%s %s is %s", (op, target, level) => {
    expect(reachOf(rules, target, op).level).toBe(level);
  });
});

describe("reachOf at one depth", () => {
  const ssh = {
    level: "ask",
    path: `${home}/.ssh`,
    place: "passwords",
    source: "place",
  } as const;
  const hiddenEntries = {
    dotEntries: true,
    level: "allow",
    path: home,
    place: "appFiles",
    source: "place",
  } as const;

  // The native profiles rank the two the same way, so the shell's own
  // commands and the programs it starts agree on ~/.ssh.
  it.each([
    ["named first", [ssh, hiddenEntries]],
    ["named last", [hiddenEntries, ssh]],
  ] as const)(
    "lets a rule naming a hidden entry outrank every hidden entry, %s",
    (_order, rules) => {
      expect(
        reachOf(
          { home, rules: [...rules], dangerouslyAllowEveryFolder: false },
          `${home}/.ssh/id_ed25519`,
          "read",
        ).level,
      ).toBe("ask");
    },
  );
});

describe("reachOf on Windows, where a name's trailing dots are dropped", () => {
  const platform = process.platform;
  const rules: Rules = {
    home,
    rules: [
      { level: "allow", path: "/ws", source: "folder" },
      {
        appData: true,
        level: "never",
        path: "/ws/.instrument",
        source: "system",
      },
    ],
    dangerouslyAllowEveryFolder: false,
  };

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
  });

  it.each([".instrument.", ".instrument ", ".instrument. ."])(
    "closes /ws/%s/chats/c/chat.db as the app's own data",
    (name) => {
      Object.defineProperty(process, "platform", { value: "win32" });
      expect(reachOf(rules, `/ws/${name}/chats/c/chat.db`, "read").level).toBe(
        "never",
      );
    },
  );
});

/**
 * NTFS opens a folder by two more names than its own: its 8.3 short name
 * (`INSTRU~1`, in any case) and its `::$INDEX_ALLOCATION` stream. Node opens
 * both, so the rules decide on the path as the system resolves it, and the
 * stream's `:` is never part of a name there. The system's resolver is
 * stood in for here, as it answers on Windows.
 */
describe("reachOf on Windows, where a folder has second names", () => {
  const platform = process.platform;
  const rules: Rules = {
    home,
    rules: [
      { level: "allow", path: "/ws", source: "folder" },
      {
        appData: true,
        level: "never",
        path: "/ws/.instrument",
        source: "system",
      },
    ],
    dangerouslyAllowEveryFolder: false,
  };

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.spyOn(fs.realpathSync, "native").mockImplementation((given) => {
      const spelled = String(given);
      const opened = spelled.replace(
        /^\/ws\/instru~1(?=\/|$)/i,
        "/ws/.instrument",
      );
      if (!/^\/ws(?:\/|$)/.test(spelled) && spelled !== "/") {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      if (
        spelled !== opened ||
        ["/", "/ws", "/ws/.instrument"].includes(spelled)
      ) {
        return opened;
      }
      // Below /ws/.instrument, as it exists on that disk.
      if (/^\/ws\/\.instrument\/keys(?:\/secret\.txt)?$/.test(spelled)) {
        return spelled;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
    vi.restoreAllMocks();
  });

  // The stood-in resolver answers for these POSIX spellings only; on Windows
  // itself the real disk answers, in the test after this block.
  it
    .skipIf(process.platform === "win32")
    .each([
      "/ws/INSTRU~1/keys/secret.txt",
      "/ws/instru~1/keys/secret.txt",
      "/ws/INSTRU~1/keys/not-yet.txt",
    ])("closes %s as the app's own data", (spelled) => {
    expect(reachOf(rules, spelled, "read")).toMatchObject({
      level: "never",
      rule: { appData: true },
    });
  });

  it.each([
    "/ws/.instrument::$INDEX_ALLOCATION/keys/secret.txt",
    String.raw`C:\ws\.instrument::$INDEX_ALLOCATION\keys\secret.txt`,
    String.raw`\\?\C:\ws\notes.txt:hidden`,
    "/ws/notes.txt:Zone.Identifier",
  ])("closes %s, a path through a stream", (spelled) => {
    expect(reachOf(rules, spelled, "read")).toEqual({
      level: "never",
      stream: true,
    });
  });

  it.each([String.raw`C:\ws\notes.txt`, String.raw`\\?\C:\ws\notes.txt`])(
    "takes the drive's own colon in %s for no stream",
    (spelled) => {
      expect(reachOf(rules, spelled, "read").stream).toBeUndefined();
    },
  );

  it("leaves the folder's own files open", () => {
    expect(reachOf(rules, "/ws/notes.txt", "read").level).toBe("allow");
  });
});

it.runIf(process.platform === "win32")(
  "closes every spelling NTFS opens a closed folder by, on a real disk",
  () => {
    const ws = fs.mkdtempSync(nodePath.join(os.tmpdir(), "second-names-"));
    try {
      fs.mkdirSync(nodePath.join(ws, ".instrument", "keys"), {
        recursive: true,
      });
      fs.writeFileSync(nodePath.join(ws, ".instrument", "keys", "a.txt"), "");
      fs.writeFileSync(nodePath.join(ws, "notes.txt"), "");
      // Whether this volume gives a folder a second name of the 8.3 kind.
      // Windows leaves them off on a drive added after the system one, which
      // is where a CI runner puts its temp folder; there `.instrument` has
      // only its own name, and the other spellings below are still worth
      // checking.
      const shortNames = fs.existsSync(nodePath.join(ws, "INSTRU~1"));
      const rules: Rules = {
        home,
        rules: [
          { level: "allow", path: ws, source: "folder" },
          {
            appData: true,
            level: "never",
            path: nodePath.join(ws, ".instrument"),
            source: "system",
          },
        ],
        dangerouslyAllowEveryFolder: false,
      };
      const levelOf = (...segments: string[]) =>
        reachOf(rules, nodePath.join(ws, ...segments), "read").level;

      const short = shortNames
        ? {
            short: levelOf("INSTRU~1", "keys", "a.txt"),
            shortLower: levelOf("instru~1", "keys", "a.txt"),
            shortNotYet: levelOf("INSTRU~1", "keys", "not-yet.txt"),
          }
        : {};

      expect({
        ...short,
        stream: levelOf(".instrument::$INDEX_ALLOCATION", "keys", "a.txt"),
        trailingDot: levelOf(".instrument.", "keys", "a.txt"),
        upper: levelOf(".INSTRUMENT", "keys", "a.txt"),
        open: levelOf("notes.txt"),
      }).toEqual({
        ...(shortNames
          ? { short: "never", shortLower: "never", shortNotYet: "never" }
          : {}),
        stream: "never",
        trailingDot: "never",
        upper: "never",
        open: "allow",
      });
    } finally {
      fs.rmSync(ws, { force: true, recursive: true });
    }
  },
);

describe("a skill source the shell mounts", () => {
  // The app's prepared skills, where they are: a hidden folder in the home
  // folder, which no place and no sign-in list names.
  const skills = inHome(".instrument-runtime/skills");

  it("is read from a hidden folder in the home folder without being named", () => {
    const rules = rulesFor({ home, settings });
    expect(
      reachOf(rules, nodePath.join(skills, "pdf/SKILL.md"), "read").level,
    ).toBe("allow");
    expect(
      reachOf(rules, nodePath.join(skills, "pdf/SKILL.md"), "write").level,
    ).toBe("ask");
  });

  it("is read without asking once it is", () => {
    const rules = rulesFor({ extraReadOnly: [skills], home, settings });
    expect(
      reachOf(rules, nodePath.join(skills, "pdf/SKILL.md"), "read").level,
    ).toBe("allow");
  });

  it("is still never changed", () => {
    const rules = rulesFor({ extraReadOnly: [skills], home, settings });
    expect(
      reachOf(rules, nodePath.join(skills, "pdf/SKILL.md"), "write").level,
    ).not.toBe("allow");
  });
});
