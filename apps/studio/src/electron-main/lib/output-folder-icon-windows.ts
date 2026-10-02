import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import iconPath from "../../../resources/instrument-folder-windows.ico?asset";

const exec = promisify(execFile);
const ini = Buffer.from(
  "\uFEFF[.ShellClassInfo]\r\nIconFile=.instrument-folder.ico\r\nIconIndex=0\r\n",
  "utf16le",
);

export async function applyWindowsFolderIcon(folder: string): Promise<void> {
  const desktopIni = path.join(folder, "desktop.ini");
  const existing = await fs.readFile(desktopIni).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  });
  // Preserve all user customization, including unrelated desktop.ini settings.
  if (existing && !existing.equals(ini)) return;
  const target = path.join(folder, ".instrument-folder.ico");
  const icon = await fs.readFile(iconPath);
  try {
    await fs.writeFile(target, icon, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
    const existingIcon = await fs.readFile(target);
    if (!existingIcon.equals(icon)) return;
  }
  if (!existing) {
    try {
      await fs.writeFile(desktopIni, ini, { flag: "wx" });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        return;
      throw error;
    }
  }
  // Read-only on a directory enables Shell customization; it does not deny writes.
  await exec("attrib.exe", ["+h", target], { timeout: 5000 });
  await exec("attrib.exe", ["+h", "+s", desktopIni], { timeout: 5000 });
  await exec("attrib.exe", ["+r", folder], { timeout: 5000 });
  const refresh = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class FolderIconRefresh { [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern void SHChangeNotify(uint change, uint flags, string path, IntPtr unused); }'; [FolderIconRefresh]::SHChangeNotify(0x2000, 0x1005, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(folder).toString("base64")}')), [IntPtr]::Zero)`;
  await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(refresh, "utf16le").toString("base64"),
    ],
    { timeout: 10_000 },
  );
}
