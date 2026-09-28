import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) };
});
vi.mock("../../../resources/instrument-folder-windows.ico?asset", async () => {
  const { fileURLToPath } = await import("node:url");
  return {
    default: fileURLToPath(
      new URL(
        "../../../resources/instrument-folder-windows.ico",
        import.meta.url,
      ),
    ),
  };
});

import { applyLinuxFolderIcon } from "./output-folder-icon-linux";
import { applyWindowsFolderIcon } from "./output-folder-icon-windows";

let folder: string;
beforeEach(async () => {
  folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "instrument-icon-platform-"),
  );
  execute.mockReset().mockResolvedValue({ stderr: "", stdout: "" });
});
afterEach(async () => {
  await fs.rm(folder, { force: true, recursive: true });
});

it("writes a Unicode Windows customization and sets Shell attributes", async () => {
  await applyWindowsFolderIcon(folder);
  const ini = await fs.readFile(path.join(folder, "desktop.ini"));
  expect(ini.toString("utf16le")).toBe(
    "\uFEFF[.ShellClassInfo]\r\nIconFile=.instrument-folder.ico\r\nIconIndex=0\r\n",
  );
  expect(
    execute.mock.calls.slice(0, 3).map(([file, args]) => [file, args]),
  ).toEqual([
    ["attrib.exe", ["+h", path.join(folder, ".instrument-folder.ico")]],
    ["attrib.exe", ["+h", "+s", path.join(folder, "desktop.ini")]],
    ["attrib.exe", ["+r", folder]],
  ]);
  const icon = await fs.readFile(path.join(folder, ".instrument-folder.ico"));
  expect(icon.readUInt16LE(2)).toBe(1);
  expect(icon.readUInt16LE(4)).toBe(6);
  await applyWindowsFolderIcon(folder);
  expect(await fs.readFile(path.join(folder, "desktop.ini"))).toEqual(ini);
});

it("preserves preexisting Windows customization", async () => {
  const file = path.join(folder, "desktop.ini");
  const custom = "[.ShellClassInfo]\r\nIconResource=personal.ico,0\r\n";
  await fs.writeFile(file, custom);
  await applyWindowsFolderIcon(folder);
  expect(await fs.readFile(file, "utf8")).toBe(custom);
  expect(await fs.readdir(folder)).toEqual(["desktop.ini"]);
  expect(execute).not.toHaveBeenCalled();
});

it("does not overwrite an unrelated file occupying the Windows asset path", async () => {
  const icon = path.join(folder, ".instrument-folder.ico");
  await fs.writeFile(icon, "personal");
  await applyWindowsFolderIcon(folder);
  expect(await fs.readFile(icon, "utf8")).toBe("personal");
  expect(execute).not.toHaveBeenCalled();
});

it("writes KDE metadata and a GIO file URI for the same SVG", async () => {
  await applyLinuxFolderIcon(folder);
  expect(await fs.readFile(path.join(folder, ".directory"), "utf8")).toBe(
    "[Desktop Entry]\nIcon=./.instrument-folder.svg\n",
  );
  expect(execute).toHaveBeenLastCalledWith(
    "gio",
    [
      "set",
      "-t",
      "string",
      folder,
      "metadata::custom-icon",
      pathToFileURL(path.join(folder, ".instrument-folder.svg")).href,
    ],
    { timeout: 5000 },
  );
});

it.each([
  "metadata::custom-icon: file:///personal.svg",
  "metadata::custom-icon-name: folder-red",
])("preserves GIO customization: %s", async (attribute) => {
  execute.mockResolvedValue({
    stderr: "",
    stdout: `attributes:\n  ${attribute}\n`,
  });
  await applyLinuxFolderIcon(folder);
  expect(await fs.readdir(folder)).toEqual([]);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("preserves preexisting KDE settings", async () => {
  await fs.writeFile(
    path.join(folder, ".directory"),
    "[Desktop Entry]\nIcon=folder-red\n",
  );
  await applyLinuxFolderIcon(folder);
  expect(await fs.readdir(folder)).toEqual([".directory"]);
  expect(execute).not.toHaveBeenCalled();
});

it("supports KDE without GIO installed", async () => {
  execute.mockRejectedValue(new Error("gio not installed"));
  await applyLinuxFolderIcon(folder);
  expect(await fs.readdir(folder)).toEqual([
    ".directory",
    ".instrument-folder.svg",
  ]);
});

it("does not rewrite GIO metadata that already points to the app's icon", async () => {
  await applyLinuxFolderIcon(folder);
  execute.mockClear().mockResolvedValue({
    stderr: "",
    stdout: `metadata::custom-icon: ${pathToFileURL(path.join(folder, ".instrument-folder.svg")).href}`,
  });
  await applyLinuxFolderIcon(folder);
  expect(execute).toHaveBeenCalledTimes(1);
});
