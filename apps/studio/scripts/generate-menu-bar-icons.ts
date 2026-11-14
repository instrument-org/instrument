import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The menu bar and tray icon: the app's glyph in one color, plain, with a
// small dot while a chat works, and with a larger dot cut out of its corner
// while a chat needs the person. Black for macOS, where the files are
// template images the system tints, and for light Windows taskbars; white for
// dark taskbars and Linux top bars. Each at 16px and 32px (@2x).
//
// Run from the repository root:
//   node apps/studio/scripts/generate-menu-bar-icons.ts
// Requires ImageMagick (`magick`).

const studio = path.resolve(import.meta.dirname, "..");
const out = path.join(studio, "resources/menu-bar");
const glyphSource = fs.readFileSync(
  path.join(studio, "src/client/components/brand-icon.tsx"),
  "utf8",
);
const glyphPath = /brandIconGlyphPath =\s*"([^"]+)"/.exec(glyphSource)?.[1];
if (!glyphPath) {
  throw new Error("brand-icon.tsx no longer defines brandIconGlyphPath");
}

// Where each state's dot sits on a 32px canvas: its center, its radius, and
// the clear ring cut around it so it reads apart from the glyph.
const DOTS = {
  ask: { cx: 26, cy: 6, gap: 2, r: 4.5 },
  idle: undefined,
  working: { cx: 27, cy: 27, gap: 1.5, r: 3.5 },
} as const;

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "menu-bar-icon-"));
try {
  fs.mkdirSync(out, { recursive: true });
  for (const color of ["black", "white"] as const) {
    const svg = path.join(temporary, `${color}.svg`);
    fs.writeFileSync(
      svg,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="40 40 440 440" width="440" height="440"><path d="${glyphPath}" fill="${color}"/></svg>`,
    );
    for (const [state, dot] of Object.entries(DOTS)) {
      const name = color === "black" ? `${state}Template` : `${state}-white`;
      const big = path.join(out, `${name}@2x.png`);
      const args = [
        "-background",
        "none",
        svg,
        "-resize",
        "32x32",
        ...(dot
          ? [
              "(",
              "-size",
              "32x32",
              "xc:none",
              "-fill",
              "black",
              "-draw",
              `circle ${dot.cx},${dot.cy} ${dot.cx},${dot.cy - dot.r - dot.gap}`,
              ")",
              "-compose",
              "DstOut",
              "-composite",
              "-compose",
              "Over",
              "-fill",
              color,
              "-draw",
              `circle ${dot.cx},${dot.cy} ${dot.cx},${dot.cy - dot.r}`,
            ]
          : []),
        big,
      ];
      execFileSync("magick", args);
      execFileSync("magick", [
        big,
        "-resize",
        "16x16",
        path.join(out, `${name}.png`),
      ]);
    }
  }
} finally {
  fs.rmSync(temporary, { force: true, recursive: true });
}
