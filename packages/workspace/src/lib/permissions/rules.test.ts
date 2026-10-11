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
    ["read", `${home}/.ssh/id_ed25519`, "never"],
    ["read", `${home}/.config/uv/uv.toml`, "ask"],
    ["read", `${home}/Library/Preferences/x.plist`, "ask"],
    ["write", `${home}/Documents/Instrument/out.png`, "allow"],
    ["read", "/Volumes/Backup/photos", "ask"],
    ["read", "/usr/bin/env", "allow"],
    ["write", "/opt/thing", "ask"],
  ] as const)("%s %s is %s", (op, target, level) => {
    expect(reachOf(rules, target, op).level).toBe(level);
  });

  it("turns asks into allows without asking, never never", () => {
    const relaxed = { ...rules, withoutAsking: true };
    expect(reachOf(relaxed, `${home}/Desktop/a.png`, "write").level).toBe(
      "allow",
    );
    expect(reachOf(relaxed, `${home}/.aws/credentials`, "read").level).toBe(
      "never",
    );
  });

  it("lets a person's place change stand", () => {
    const open = rulesFor({
      home,
      settings: { ...settings, places: { passwords: "allow" } },
    });
    expect(reachOf(open, `${home}/.ssh/config`, "read").level).toBe("allow");
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
      folderToAskFor({ home, hostPath, isDirectory, rule: documents }),
    ).toBe(expected);
  });

  it("asks one level below home where no rule holds the path", () => {
    expect(
      folderToAskFor({
        home,
        hostPath: `${home}/Projects/site/index.html`,
        isDirectory: false,
        rule: undefined,
      }),
    ).toBe(`${home}/Projects`);
  });
});
