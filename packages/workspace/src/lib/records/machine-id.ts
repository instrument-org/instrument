import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

/**
 * The machine's own id, which stays the same across reinstalls of the app
 * and differs on other hardware: macOS's `IOPlatformUUID`, Windows'
 * `MachineGuid`, Linux's `/etc/machine-id` (or D-Bus's copy of it).
 */

export type MachineIdRead =
  | { id: string; kind: "read" }
  | { kind: "unreadable"; why: string };

/** Where the id comes from, apart so a test can stand in for the machine. */
export interface MachineIdSources {
  platform: NodeJS.Platform;
  readFile(file: string): Promise<string>;
  run(command: string, args: string[]): Promise<string>;
}

const COMMAND_TIMEOUT_MS = 5000;

const run = promisify(execFile);

const SYSTEM: MachineIdSources = {
  platform: process.platform,
  readFile: (file) => fs.readFile(file, "utf8"),
  run: async (command, args) =>
    (
      await run(command, args, {
        encoding: "utf8",
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      })
    ).stdout,
};

const LINUX_FILES = ["/etc/machine-id", "/var/lib/dbus/machine-id"];

export async function readMachineId(
  sources: MachineIdSources = SYSTEM,
): Promise<MachineIdRead> {
  try {
    switch (sources.platform) {
      case "darwin":
        return found(
          /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(
            await sources.run("ioreg", [
              "-rd1",
              "-c",
              "IOPlatformExpertDevice",
            ]),
          )?.[1],
          "ioreg named no IOPlatformUUID",
        );
      case "win32":
        return found(
          /MachineGuid\s+REG_SZ\s+(\S+)/.exec(
            await sources.run("reg", [
              "query",
              "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
              "/v",
              "MachineGuid",
            ]),
          )?.[1],
          "the registry named no MachineGuid",
        );
      case "linux":
        return await readLinuxId(sources);
      default:
        return {
          kind: "unreadable",
          why: `${sources.platform} has no machine id this reads`,
        };
    }
  } catch (error) {
    return {
      kind: "unreadable",
      why: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readLinuxId(sources: MachineIdSources): Promise<MachineIdRead> {
  const failures: string[] = [];
  for (const file of LINUX_FILES) {
    try {
      const id = (await sources.readFile(file)).trim();
      if (id !== "") {
        return { id, kind: "read" };
      }
      failures.push(`${file} is empty`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { kind: "unreadable", why: failures.join("; ") };
}

function found(id: string | undefined, why: string): MachineIdRead {
  return id ? { id, kind: "read" } : { kind: "unreadable", why };
}
