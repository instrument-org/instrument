/**
 * Draws the Mac disk image's window background, `build/background.png` and
 * `build/background@2x.png`, from the SVG below and the positions in
 * `electron-builder/dmg-layout.ts`. electron-builder joins the pair into one
 * HiDPI TIFF, so the window is sharp on a Retina display.
 *
 * The picture takes the website's link preview: a wedge of pale mint light
 * falling from the top left into sage, with a fine grain, and nothing on it
 * but the arrow from the app to Applications.
 *
 * Finder draws the icon labels over this image, black in light mode and white
 * in dark mode, so the sage under them is the one tone both read against at
 * 4.5:1 or better. Each run measures that and fails when either falls short.
 *
 * Requires macOS (sips renders the SVG) and ImageMagick (the grain).
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

const { appIcon, applicationsIcon, height, iconSize, width } = DMG_LAYOUT;

// The light's edge, where mint gives way to sage: its height at the window's
// left and right sides, rising to the right, and how far either side of it
// the light fades.
const EDGE = { left: 165, right: 15, soft: 190 };

// Along the light, from its brightest to the sage. The sage the labels sit on
// is the luminance (about 0.18) where black and white text contrast alike.
const LIGHT: [offset: number, color: string][] = [
  [0, "#f4fcf5"],
  [0.32, "#dcefe4"],
  [0.5, "#a9bcb5"],
  [0.72, "#7d8c87"],
  [0.86, "#6b7974"],
  [1, "#6b7974"],
];

// Gaussian noise strength (ImageMagick -attenuate), the link preview's grain.
const GRAIN = 0.08;

function svg(scale: number) {
  const dx = width;
  const dy = EDGE.right - EDGE.left;
  const length = Math.hypot(dx, dy);
  // Across the edge, pointing down and to the right.
  const across = { x: -dy / length, y: dx / length };
  const middle = { x: width / 2, y: (EDGE.left + EDGE.right) / 2 };
  const start = {
    x: middle.x - across.x * EDGE.soft,
    y: middle.y - across.y * EDGE.soft,
  };
  const end = {
    x: middle.x + across.x * EDGE.soft,
    y: middle.y + across.y * EDGE.soft,
  };
  // The arrow runs between the icons' facing edges, with room either side.
  const from = appIcon.x + iconSize / 2 + 40;
  const to = applicationsIcon.x - iconSize / 2 - 40;
  const y = appIcon.y;
  const head = 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="light" gradientUnits="userSpaceOnUse" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}">
      ${LIGHT.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join("")}
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#light)"/>
  <path d="M ${from} ${y} L ${to} ${y}" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
  <path d="M ${to - head * 1.2} ${y - head} L ${to} ${y} L ${to - head * 1.2} ${y + head}" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
`;
}

function run(cmd: string, args: string[]) {
  return execFileSync(cmd, args, {
    stdio: ["ignore", "pipe", "inherit"],
  }).toString();
}

function render(scale: number, out: string, scratch: string) {
  const source = path.join(scratch, `background-${scale}x.svg`);
  const smooth = path.join(scratch, `background-${scale}x.png`);
  writeFileSync(source, svg(scale));
  run("sips", ["-s", "format", "png", source, "--out", smooth]);
  run("magick", [
    smooth,
    "-alpha",
    "off",
    "-seed",
    `${scale}`,
    "-attenuate",
    `${GRAIN}`,
    "+noise",
    "Gaussian",
    // Points per inch, so the 2x image reads as the same size as the 1x one.
    "-units",
    "PixelsPerInch",
    "-density",
    `${72 * scale}`,
    out,
  ]);
}

/** WCAG contrast of black and white text on the ground under one label. */
function labelContrast(image: string, at: { x: number; y: number }) {
  const strip = { h: 16, w: 80 };
  const hex = run("magick", [
    image,
    "-crop",
    `${strip.w}x${strip.h}+${at.x - strip.w / 2}+${at.y + iconSize / 2 + 6}`,
    "-scale",
    "1x1!",
    "-format",
    "%[hex:p{0,0}]",
    "info:",
  ]).trim();
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return {
    black: (luminance + 0.05) / 0.05,
    hex: `#${hex.slice(0, 6)}`,
    white: 1.05 / (luminance + 0.05),
  };
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
        "-gravity",
        "NorthWest",
        "-geometry",
        `+${left}+${top}`,
        "-composite",
        "-font",
        "/System/Library/Fonts/SFNS.ttf",
        "-pointsize",
        `${DMG_LAYOUT.iconTextSize * scale}`,
        "-fill",
        mode === "light" ? "black" : "white",
        // North gravity measures x from the image's center line.
        "-gravity",
        "North",
        "-annotate",
        `${item.x - width / 2 >= 0 ? "+" : ""}${(item.x - width / 2) * scale}+${(item.y + iconSize / 2 + 5) * scale}`,
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
  for (const [name, at] of [
    ["Instrument", appIcon],
    ["Applications", applicationsIcon],
  ] as const) {
    const { black, hex, white } = labelContrast(build("background.png"), at);
    console.log(
      `${name} on ${hex}: black ${black.toFixed(2)}, white ${white.toFixed(2)}`,
    );
    if (black < 4.5 || white < 4.5) {
      throw new Error(`The ground under “${name}” is under 4.5:1 for a label`);
    }
  }
  const previewAt = process.argv.indexOf("--preview");
  if (previewAt !== -1) {
    const dir = process.argv[previewAt + 1];
    if (!dir) throw new Error("--preview takes a folder");
    preview(path.resolve(dir), scratch);
  }
} finally {
  rmSync(scratch, { force: true, recursive: true });
}
