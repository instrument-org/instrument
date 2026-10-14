import { describe, expect, it } from "vitest";

import { type MachineIdSources, readMachineId } from "./machine-id";

const IOREG = `+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000202, registered, matched, active, busy 0 (0 ms), retain 39>
    {
      "IOPlatformSerialNumber" = "C02XXXXXXXXX"
      "IOPlatformUUID" = "4C4C4544-0035-3010-8052-B4C04F4E4D32"
      "model" = <"MacBookPro18,2">
    }
`;

const REG = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography
    MachineGuid    REG_SZ    6f1d9c3e-2b7a-4c55-9d0e-8a1b2c3d4e5f

`;

function machine(
  platform: NodeJS.Platform,
  {
    files = {},
    output = "",
  }: { files?: Record<string, string>; output?: string } = {},
): MachineIdSources & { commands: string[][] } {
  const commands: string[][] = [];
  return {
    commands,
    platform,
    readFile: (file) => {
      const contents = files[file];
      return contents === undefined
        ? Promise.reject(new Error(`ENOENT: ${file}`))
        : Promise.resolve(contents);
    },
    run: (command, args) => {
      commands.push([command, ...args]);
      return Promise.resolve(output);
    },
  };
}

describe("readMachineId", () => {
  it("reads a Mac's IOPlatformUUID from ioreg", async () => {
    const mac = machine("darwin", { output: IOREG });

    await expect(readMachineId(mac)).resolves.toEqual({
      id: "4C4C4544-0035-3010-8052-B4C04F4E4D32",
      kind: "read",
    });
    expect(mac.commands).toEqual([
      ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
    ]);
  });

  it("reads Windows' MachineGuid from the registry", async () => {
    const pc = machine("win32", { output: REG });

    await expect(readMachineId(pc)).resolves.toEqual({
      id: "6f1d9c3e-2b7a-4c55-9d0e-8a1b2c3d4e5f",
      kind: "read",
    });
    expect(pc.commands).toEqual([
      [
        "reg",
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
        "/v",
        "MachineGuid",
      ],
    ]);
  });

  it.each([
    [
      "/etc/machine-id",
      { "/etc/machine-id": "0123456789abcdef0123456789abcdef\n" },
    ],
    [
      "D-Bus's copy when /etc has none",
      {
        "/etc/machine-id": "\n",
        "/var/lib/dbus/machine-id": "0123456789abcdef0123456789abcdef\n",
      },
    ],
  ])("reads Linux's id from %s", async (_name, files) => {
    await expect(readMachineId(machine("linux", { files }))).resolves.toEqual({
      id: "0123456789abcdef0123456789abcdef",
      kind: "read",
    });
  });

  it.each<[string, MachineIdSources]>([
    ["ioreg says nothing of it", machine("darwin", { output: "" })],
    [
      "ioreg cannot run",
      {
        ...machine("darwin"),
        run: () => Promise.reject(new Error("spawn ioreg ENOENT")),
      },
    ],
    ["Linux has neither file", machine("linux")],
    ["the platform has none", machine("freebsd")],
  ])("says why when %s", async (_name, sources) => {
    await expect(readMachineId(sources)).resolves.toMatchObject({
      kind: "unreadable",
      why: expect.any(String),
    });
  });
});
