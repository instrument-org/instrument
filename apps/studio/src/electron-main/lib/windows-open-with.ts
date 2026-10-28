import { APP_NAME } from "@instrument-org/shared";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { WINDOWS_EXTENSIONS, WINDOWS_PROG_ID } from "../../shared/open-with";

// The keys the NSIS installer's hooks wrote and a Velopack install writes the
// same way: Instrument in each extension's Open With list and in the
// application's `SupportedTypes`, and never an extension's default, so the app
// is offered for everything it can show and the default for none of it.
const CLASSES = String.raw`HKEY_CURRENT_USER\Software\Classes`;

function quoteRegString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * The `.reg` file that registers `exePath` for every extension, or, with
 * `remove`, takes all of it out again.
 */
export function openWithRegistryFile({
  exePath,
  extensions = WINDOWS_EXTENSIONS,
  remove = false,
}: {
  exePath: string;
  extensions?: readonly string[];
  remove?: boolean;
}): string {
  const classKey = `${CLASSES}\\${WINDOWS_PROG_ID}`;
  const applicationKey = `${CLASSES}\\Applications\\${path.win32.basename(exePath)}`;
  const lines = ["Windows Registry Editor Version 5.00", ""];
  if (remove) {
    for (const extension of extensions) {
      lines.push(
        `[${CLASSES}\\.${extension}\\OpenWithProgids]`,
        `${quoteRegString(WINDOWS_PROG_ID)}=-`,
        "",
      );
    }
    lines.push(`[-${classKey}]`, "", `[-${applicationKey}]`, "");
    return lines.join("\r\n");
  }
  const open = `"${exePath}" "%1"`;
  lines.push(
    `[${classKey}]`,
    `@=${quoteRegString(`${APP_NAME} file`)}`,
    "",
    `[${classKey}\\DefaultIcon]`,
    `@=${quoteRegString(`${exePath},0`)}`,
    "",
    `[${classKey}\\shell\\open\\command]`,
    `@=${quoteRegString(open)}`,
    "",
    `[${applicationKey}\\shell\\open\\command]`,
    `@=${quoteRegString(open)}`,
    "",
    `[${applicationKey}\\SupportedTypes]`,
    ...extensions.map((extension) => `${quoteRegString(`.${extension}`)}=""`),
    "",
  );
  for (const extension of extensions) {
    lines.push(
      `[${CLASSES}\\.${extension}\\OpenWithProgids]`,
      `${quoteRegString(WINDOWS_PROG_ID)}=hex(0):`,
      "",
    );
  }
  return lines.join("\r\n");
}

// Synchronous, because Velopack's install and uninstall hooks end the process
// as soon as the hook returns.
function importRegistryFile(contents: string) {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "instrument-open-with-")),
    "open-with.reg",
  );
  // `reg import` reads UTF-16 with a byte order mark, which keeps a path with
  // characters outside ASCII intact.
  fs.writeFileSync(file, `\uFEFF${contents}`, { encoding: "utf16le" });
  try {
    const result = spawnSync("reg", ["import", file], {
      timeout: 20_000,
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(
        `reg import exited ${String(result.status)}: ${result.stderr.toString()}`,
      );
    }
  } finally {
    fs.rmSync(path.dirname(file), { force: true, recursive: true });
  }
}

/** Puts `exePath` in Explorer's Open With for every extension Instrument shows. */
export function registerOpenWith(exePath: string) {
  importRegistryFile(openWithRegistryFile({ exePath }));
}

/** Takes Instrument out of Explorer's Open With again. */
export function unregisterOpenWith(exePath: string) {
  importRegistryFile(openWithRegistryFile({ exePath, remove: true }));
}

/**
 * The command Open With runs for Instrument's class now, or undefined when
 * there is none.
 */
export function registeredOpenWithCommand(): string | undefined {
  const result = spawnSync(
    "reg",
    [
      "query",
      `${CLASSES.replace("HKEY_CURRENT_USER", "HKCU")}\\${WINDOWS_PROG_ID}\\shell\\open\\command`,
      "/ve",
    ],
    { encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  if (result.status !== 0) {
    return;
  }
  return /REG_SZ\s+(.+)$/m.exec(result.stdout)?.[1]?.trim();
}
