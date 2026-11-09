/**
 * Draws the Mac disk image's window background, `build/background.png` and
 * `build/background@2x.png`, from the SVG below and the positions in
 * `electron-builder/dmg-layout.ts`. electron-builder joins the pair into one
 * HiDPI TIFF, so the window is sharp on a Retina display.
 *
 * Finder draws the icon labels black in light mode and white in dark mode, on
 * top of this image either way, so the background is a mid-tone that both
 * read against.
 *
 * Requires macOS (sips renders the SVG) and, for --preview, ImageMagick.
 *
 * Usage:
 *   node scripts/generate-dmg-background.ts
 *   node scripts/generate-dmg-background.ts --preview <dir>
 *     also writes what the mounted window looks like, in light and dark mode
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DMG_LAYOUT } from "../electron-builder/dmg-layout.ts";

const studioDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const build = (name: string) => path.join(studioDir, "build", name);

// The brand's greens (the website's brand-300 to brand-500), held near the
// luminance where black and white text contrast about equally.
const TOP = "#46a091";
const BOTTOM = "#1f7a6d";

const { appIcon, applicationsIcon, height, iconSize, width } = DMG_LAYOUT;

function svg(scale: number) {
  const dots: string[] = [];
  const step = 16;
  for (let y = step / 2; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      dots.push(`<circle cx="${x}" cy="${y}" r="0.7"/>`);
    }
  }
  // An icon's shadow on the ground: a soft ellipse under its lower edge.
  const shadow = ({ x, y }: { x: number; y: number }) =>
    `<ellipse cx="${x}" cy="${y + iconSize * 0.48}" rx="${iconSize * 0.48}" ry="${iconSize * 0.12}" fill="url(#shadow)"/>`;
  // A light behind each icon, so an icon in the brand's own green keeps its
  // edge against the ground.
  const halo = ({ x, y }: { x: number; y: number }) =>
    `<circle cx="${x}" cy="${y}" r="${iconSize * 0.66}" fill="url(#halo)"/>`;
  // The arrow runs between the icons' facing edges, with room either side.
  const gap = 34;
  const from = appIcon.x + iconSize / 2 + gap;
  const to = applicationsIcon.x - iconSize / 2 - gap;
  const y = appIcon.y;
  const head = 11;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${TOP}"/>
      <stop offset="1" stop-color="${BOTTOM}"/>
    </linearGradient>
    <radialGradient id="glow" cx="${width / 2}" cy="${-height * 0.25}" r="${width * 0.7}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="${width / 2}" cy="${height * 0.45}" r="${width * 0.62}" gradientUnits="userSpaceOnUse">
      <stop offset="0.6" stop-color="#05201c" stop-opacity="0"/>
      <stop offset="1" stop-color="#05201c" stop-opacity="0.22"/>
    </radialGradient>
    <radialGradient id="halo">
      <stop offset="0.6" stop-color="#ffffff" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="shadow">
      <stop offset="0" stop-color="#03201b" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#03201b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="shaft" x1="${from}" y1="0" x2="${to}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#ground)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <g fill="#ffffff" fill-opacity="0.07">${dots.join("")}</g>
  <rect width="${width}" height="${height}" fill="url(#vignette)"/>
  ${halo(appIcon)}
  ${halo(applicationsIcon)}
  ${shadow(appIcon)}
  ${shadow(applicationsIcon)}
  <path d="M ${from} ${y} L ${to} ${y}" stroke="url(#shaft)" stroke-width="3.5" stroke-linecap="round" fill="none"/>
  <path d="M ${to - head} ${y - head} L ${to} ${y} L ${to - head} ${y + head}" stroke="#ffffff" stroke-opacity="0.85" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
`;
}

function run(cmd: string, args: string[]) {
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
}

function render(scale: number, out: string, scratch: string) {
  const source = path.join(scratch, `background-${scale}x.svg`);
  writeFileSync(source, svg(scale));
  run("sips", ["-s", "format", "png", source, "--out", out]);
  // Points per inch, so the 2x image reads as the same size as the 1x one.
  run("sips", [
    "-s",
    "dpiWidth",
    `${72 * scale}`,
    "-s",
    "dpiHeight",
    `${72 * scale}`,
    out,
  ]);
}

/**
 * The window as Finder shows it: the 2x background with the app icon and the
 * Applications folder at their configured places, labels in the mode's color.
 */
function preview(dir: string, scratch: string) {
  mkdirSync(dir, { recursive: true });
  const scale = 2;
  const size = iconSize * scale;
  const folder = path.join(scratch, "applications.png");
  run("sips", [
    "-s",
    "format",
    "png",
    "-z",
    `${size}`,
    `${size}`,
    "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns",
    "--out",
    folder,
  ]);
  const items = [
    { file: build("icon.png"), label: "Instrument", ...appIcon },
    { file: folder, label: "Applications", ...applicationsIcon },
  ];
  for (const mode of ["light", "dark"] as const) {
    const args = [build("background@2x.png")];
    for (const item of items) {
      const left = (item.x - iconSize / 2) * scale;
      const top = (item.y - iconSize / 2) * scale;
      args.push(
        "(",
        item.file,
        "-resize",
        `${size}x${size}`,
        ")",
        "-geometry",
        `+${left}+${top}`,
        "-composite",
        "-font",
        "/System/Library/Fonts/SFNS.ttf",
        "-pointsize",
        `${DMG_LAYOUT.iconTextSize * scale}`,
        "-fill",
        mode === "light" ? "black" : "white",
        "-gravity",
        "NorthWest",
        "-annotate",
        // Centered under the icon by measuring nothing: close enough for a look.
        `+${(item.x - item.label.length * 3.6) * scale}+${(item.y + iconSize / 2 + 6) * scale}`,
        item.label,
      );
    }
    args.push(path.join(dir, `dmg-window-${mode}.png`));
    run("magick", args);
  }
}

const scratch = mkdtempSync(path.join(tmpdir(), "dmg-background-"));
try {
  render(1, build("background.png"), scratch);
  render(2, build("background@2x.png"), scratch);
  const previewAt = process.argv.indexOf("--preview");
  if (previewAt !== -1) {
    const dir = process.argv[previewAt + 1];
    if (!dir) throw new Error("--preview takes a folder");
    preview(path.resolve(dir), scratch);
  }
} finally {
  rmSync(scratch, { force: true, recursive: true });
}
