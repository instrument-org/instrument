import { spawnSync } from "node:child_process";
/**
 * Generates all platform icon outputs from two source ONGs in icons/source/.
 * Requires: magick (ImageMagick) and iconutil (macOS).
 *
 * Usage:
 *   node scripts/generate-icons.ts          # generate + write hash snapshot
 *   node scripts/generate-icons.ts --check  # verify outputs match snapshot
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studioDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const src = (name: string) => path.join(studioDir, "icons", "source", name);
const build = (name: string) => path.join(studioDir, "build", name);
const resources = (name: string) => path.join(studioDir, "resources", name);

// solid-square: full-bleed, no rounding — only used for the Tahoe .icon bundle.
// actool needs the artwork without any baked rounding so it can apply Liquid Glass itself.
const SQUARE = src("instrument-solid-square.png");
// solid-rounded: designer-provided squircle with padding — used for all other targets.
const ROUNDED = src("instrument-solid-rounded.png");

const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512] as const;
const ICNS_SIZES = [16, 32, 128, 256, 512] as const;

// The shipping artwork recolored for builds that are not the shipping app
// (APP_FLAVOR), as ImageMagick `-modulate` brightness,saturation,hue. A hue
// shift keeps the artwork's gradient and glass intact.
const PREVIEW_TINT = "100,110,150"; // purple
const DEVELOPMENT_TINT = "100,30,125"; // slate
const BRAND_FILL = "#0b6056";
const BRAND_FILL_SOLID = "srgb:0.04314,0.37647,0.33725,1.00000";
const flavor = (name: string) => build(path.join("flavors", name));

// All files that must exist and be hash-stable after generation.
const OUTPUTS = [
  build("icon.icns"),
  build("icon.ico"),
  build("icon.png"),
  build("icon.icon/icon.json"),
  build("icon.icon/Assets/icon.png"),
  resources("icon.png"),
  ...LINUX_SIZES.map((s) => build(`icons/${s}x${s}.png`)),
  // A preview's whole set, read by electron-builder.ts.
  flavor("preview/icon.icns"),
  flavor("preview/icon.ico"),
  flavor("preview/icon.icon/icon.json"),
  flavor("preview/icon.icon/Assets/icon.png"),
  ...LINUX_SIZES.map((s) => flavor(`preview/icons/${s}x${s}.png`)),
  // Only the Dock's: a development run sets it at launch.
  flavor("development/icon.png"),
];

function buildIcns(input: string, output: string) {
  const iconset = output.replace(/\.icns$/, ".iconset");
  rmSync(iconset, { force: true, recursive: true });
  mkdirSync(iconset, { recursive: true });

  for (const s of ICNS_SIZES) {
    resize(input, path.join(iconset, `icon_${s}x${s}.png`), s);
    resize(input, path.join(iconset, `icon_${s}x${s}@2x.png`), s * 2);
  }

  run("iconutil", ["-c", "icns", iconset, "-o", output]);
  rmSync(iconset, { force: true, recursive: true });
}

function check() {
  const snapshotPath = path.join(studioDir, "icons", ".generated-hashes.json");
  if (!existsSync(snapshotPath)) {
    throw new Error(
      "No hash snapshot found. Run: pnpm --filter @instrument-org/studio icons:generate",
    );
  }
  const expected = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<
    string,
    string
  >;
  const stale: string[] = [];
  for (const p of OUTPUTS) {
    const key = path.relative(studioDir, p);
    if (!existsSync(p)) {
      stale.push(`${key} (missing)`);
      continue;
    }
    if (expected[key] !== hashFile(p)) {
      stale.push(key);
    }
  }
  if (stale.length > 0) {
    throw new Error(`Icon outputs are out of date:\n${stale.join("\n")}`);
  }
  console.log("Icons are up to date.");
}

function generate() {
  for (const tool of ["magick", "iconutil"]) {
    if (spawnSync("which", [tool]).status !== 0) {
      throw new Error(`Missing required tool: ${tool}`);
    }
  }
  if (!existsSync(SQUARE) || !existsSync(ROUNDED)) {
    throw new Error(`Missing source icons in icons/source/`);
  }

  mkdirSync(build("icons"), { recursive: true });
  mkdirSync(resources(""), { recursive: true });

  // macOS legacy, Windows, Linux: designer-rounded source with baked squircle + padding
  copyFileSync(ROUNDED, build("icon.png"));
  copyFileSync(ROUNDED, resources("icon.png"));
  buildIcns(ROUNDED, build("icon.icns"));
  run("magick", [
    ROUNDED,
    "-define",
    "icon:auto-resize=256,128,64,48,32,16",
    build("icon.ico"),
  ]);
  for (const s of LINUX_SIZES) {
    resize(ROUNDED, build(`icons/${s}x${s}.png`), s);
  }

  // macOS 26+ Tahoe: full-bleed square so actool can apply Liquid Glass mask cleanly
  writeIconBundle(SQUARE, build("icon.icon"), BRAND_FILL_SOLID);

  generatePreview();
  mkdirSync(flavor("development"), { recursive: true });
  run("magick", [
    ROUNDED,
    "-resize",
    "512x512",
    "-modulate",
    DEVELOPMENT_TINT,
    flavor("development/icon.png"),
  ]);

  console.log("Icons generated.");
}

function generatePreview() {
  const dir = flavor("preview");
  rmSync(dir, { force: true, recursive: true });
  mkdirSync(path.join(dir, "icons"), { recursive: true });
  const rounded = path.join(dir, "rounded.png");
  const square = path.join(dir, "square.png");
  tint(ROUNDED, rounded, PREVIEW_TINT);
  tint(SQUARE, square, PREVIEW_TINT);

  buildIcns(rounded, path.join(dir, "icon.icns"));
  run("magick", [
    rounded,
    "-define",
    "icon:auto-resize=256,128,64,48,32,16",
    path.join(dir, "icon.ico"),
  ]);
  for (const s of LINUX_SIZES) {
    resize(rounded, path.join(dir, `icons/${s}x${s}.png`), s);
  }
  writeIconBundle(
    square,
    path.join(dir, "icon.icon"),
    iconComposerColor(tintColor(BRAND_FILL)),
  );
  rmSync(rounded);
  rmSync(square);
}

function hashFile(p: string) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function resize(input: string, output: string, size: number) {
  mkdirSync(path.dirname(output), { recursive: true });
  run("magick", [input, "-resize", `${size}x${size}`, output]);
}

function tint(input: string, output: string, modulate: string) {
  run("magick", [input, "-modulate", modulate, output]);
}

// The bundle's fill, shifted the way the artwork over it is.
function tintColor(hex: string) {
  const r = spawnSync(
    "magick",
    [
      "xc:" + hex,
      "-modulate",
      PREVIEW_TINT,
      "-format",
      "%[pixel:p{0,0}]",
      "info:",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(r.stderr);
  }
  return r.stdout.trim();
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr || r.stdout}`);
  }
}

// The .icon bundle is the Icon Composer format used by macOS 26+.
// It's a folder with icon.json (metadata) and an Assets/ dir with the artwork.
// electron-builder feeds it to actool at build time to produce Assets.car.
// The fill color in icon.json is brand-600 (#0b6056), or that color tinted the
// way the artwork is, in Icon Composer's notation.
function writeIconBundle(squarePng: string, bundleDir: string, fill: string) {
  rmSync(bundleDir, { force: true, recursive: true });
  mkdirSync(path.join(bundleDir, "Assets"), { recursive: true });

  // Copy the full-bleed square directly — no layer extraction needed.
  copyFileSync(squarePng, path.join(bundleDir, "Assets", "icon.png"));

  writeFileSync(
    path.join(bundleDir, "icon.json"),
    JSON.stringify(
      {
        fill: { solid: fill },
        groups: [
          {
            "blur-material": null,
            layers: [
              {
                glass: false,
                hidden: false,
                "image-name": "icon.png",
                name: "icon",
                position: { scale: 1, "translation-in-points": [0, 0] },
              },
            ],
            lighting: "individual",
            shadow: { kind: "neutral", opacity: 0 },
            specular: false,
            translucency: { enabled: false, value: 0 },
          },
        ],
        "supported-platforms": { squares: "shared" },
      },
      null,
      2,
    ) + "\n",
  );
}

// Icon Composer's color notation: "srgb:r,g,b,a" with each channel 0 to 1.
function iconComposerColor(color: string) {
  const r = spawnSync(
    "magick",
    ["xc:" + color, "-format", "%[fx:r],%[fx:g],%[fx:b]", "info:"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(r.stderr);
  }
  const channels = r.stdout
    .trim()
    .split(",")
    .map((value) => Number(value).toFixed(5));
  return `srgb:${channels.join(",")},1.00000`;
}

function writeSnapshot() {
  const hashes: Record<string, string> = {};
  for (const p of OUTPUTS) {
    if (!existsSync(p)) {
      throw new Error(`Missing output after generate: ${p}`);
    }
    hashes[path.relative(studioDir, p)] = hashFile(p);
  }
  writeFileSync(
    path.join(studioDir, "icons", ".generated-hashes.json"),
    JSON.stringify(hashes, null, 2) + "\n",
  );
}

try {
  if (process.argv.includes("--check")) {
    check();
  } else {
    generate();
    writeSnapshot();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
