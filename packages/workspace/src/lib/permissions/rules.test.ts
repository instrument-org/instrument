import { describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { folderToAskFor, reachOf, rulesFor } from "./rules";

const home = "/Users/someone";
const settings = { apps: [], folders: [], places: {}, withoutAsking: false };

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
    ["read", `${home}/.config/uv/uv.toml`, "ask"],
    ["read", `${home}/Library/Preferences/x.plist`, "ask"],
    ["write", `${home}/Documents/Instrument/out.png`, "allow"],
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
    const relaxed = { ...rules, withoutAsking: true };
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
      settings: { ...settings, withoutAsking: true },
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
    path: `${home}/Documents`,
    source: "place",
  } as const;

  it.each([
    [
      `${home}/Documents/Clients/Acme/a.pdf`,
      false,
      `${home}/Documents/Clients`,
    ],
    [`${home}/Documents/report.pdf`, false, `${home}/Documents`],
    [`${home}/Documents/Clients`, true, `${home}/Documents/Clients`],
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
    [`${home}/.ssh/config`, `${home}/.ssh`],
    [`${home}/.ssh/keys/work/id_ed25519`, `${home}/.ssh`],
    [`${home}/.config/gh/hosts.yml`, `${home}/.config/gh`],
    [`${home}/.netrc`, `${home}/.netrc`],
    [`${home}/.docker/config.json`, `${home}/.docker/config.json`],
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
        hostPath: `${home}/Projects/site/index.html`,
        isDirectory: false,
        rule: undefined,
        rules: rulesFor({ home, settings }),
      }),
    ).toBe(`${home}/Projects`);
  });

  // The app's own data in a place that asks, as the machine folder sits in
  // the Library on a Mac: a card for something beside it names the folder
  // below the one that holds it, and one with nothing below asks for the
  // folder that holds it, which ruleRefusal raises no card for.
  it.each([
    [
      `${home}/Library/Application Support/Other/state.json`,
      false,
      `${home}/Library/Application Support/Other`,
    ],
    [
      `${home}/Library/Application Support/Other/cache/a`,
      true,
      `${home}/Library/Application Support/Other`,
    ],
    [
      `${home}/Library/Application Support`,
      true,
      `${home}/Library/Application Support`,
    ],
    [
      `${home}/Library/Preferences/x.plist`,
      false,
      `${home}/Library/Preferences`,
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
            path: `${home}/Library/Application Support/Instrument`,
            source: "system",
          } as const,
        ],
      };
      expect(
        folderToAskFor({
          hostPath,
          isDirectory,
          rule: { level: "ask", path: `${home}/Library`, source: "place" },
          rules,
        }),
      ).toBe(expected);
    },
  );
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
          { home, rules: [...rules], withoutAsking: false },
          `${home}/.ssh/id_ed25519`,
          "read",
        ).level,
      ).toBe("ask");
    },
  );
});
