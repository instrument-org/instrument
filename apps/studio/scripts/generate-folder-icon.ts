import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// AppKit renders the SVG; ImageMagick packages the Windows icon sizes.
const resources = path.resolve(import.meta.dirname, "../resources");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "folder-icon-"));
try {
  const png = path.join(temporary, "folder.png");
  const script = `ObjC.import("AppKit"); function run(argv) {
    const image = $.NSImage.alloc.initWithContentsOfFile(argv[0]);
    const rep = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
    const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
    if (!png.writeToFileAtomically(argv[1], true)) throw Error("Cannot write PNG");
  }`;
  execFileSync("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    script,
    path.join(resources, "instrument-folder-windows.svg"),
    png,
  ]);
  execFileSync("magick", [
    png,
    "-define",
    "icon:auto-resize=256,128,64,48,32,16",
    path.join(resources, "instrument-folder-windows.ico"),
  ]);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
