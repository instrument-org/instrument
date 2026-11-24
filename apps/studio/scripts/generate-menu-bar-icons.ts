import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The menu bar and tray icon: the app's glyph in one color, plain, or with a
// still dot cut into its top corner, green while a chat runs and orange while
// one needs the person. Each state in a black glyph, for light menu bars and
// taskbars, and a white one, for dark ones and Linux top bars, with the dot in
// the system's own green or orange for that background. Each at 16px and
// 32px (@2x).
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

// The dot on a 32px canvas: its center, its radius, and the clear ring cut
// around it so it reads apart from the glyph. Small, like the dots other
// menu bar icons wear.
const DOT = { cx: 26.5, cy: 5.5, gap: 1.5, r: 4.6 };

// The dot's color per state, on a light bar (black glyph) and a dark one
// (white glyph): Apple's system green and orange for each appearance.
const DOT_COLORS = {
  ask: { black: "#FF9500", white: "#FF9F0A" },
  idle: undefined,
  working: { black: "#34C759", white: "#30D158" },
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
    for (const [state, colors] of Object.entries(DOT_COLORS)) {
      const name = `${state}-${color}`;
      const big = path.join(out, `${name}@2x.png`);
      const args = [
        "-background",
        "none",
        svg,
        "-resize",
        "32x32",
        ...(colors
          ? [
              "(",
              "-size",
              "32x32",
              "xc:none",
              "-fill",
              "black",
              "-draw",
              `circle ${DOT.cx},${DOT.cy} ${DOT.cx},${DOT.cy - DOT.r - DOT.gap}`,
              ")",
              "-compose",
              "DstOut",
              "-composite",
              "-compose",
              "Over",
              "-fill",
              colors[color],
              "-draw",
              `circle ${DOT.cx},${DOT.cy} ${DOT.cx},${DOT.cy - DOT.r}`,
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
