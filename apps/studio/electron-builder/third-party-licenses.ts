// Writes the license texts of the native programs and WebAssembly the app
// ships into a `licenses/` folder under the packaged app's resources, with a
// README.txt that names each one, its version and license, and for GPL
// programs where their source lives upstream. Settings › General › About opens
// the folder.
//
// Texts come from the package that ships each program wherever it carries
// them. Where it does not, they are kept under `apps/studio/licenses/<id>/`,
// taken from the upstream tag of the version in use, and pinned to that
// version: a dependency bump that moves the program fails packaging until the
// texts and source pointers are refreshed.
//
// Loaded as TS directly: electron-builder runs configs through jiti, so no
// separate compile step is needed.

import { APP_NAME } from "@instrument-org/shared";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { ElectronPlatform } from "./paths";

import { THIRD_PARTY_NOTICES_FILE_NAME } from "./third-party-notices";

const STUDIO_DIR = path.resolve(import.meta.dirname, "..");
const PACKAGE_ROOTS = {
  studio: STUDIO_DIR,
  workspace: path.resolve(STUDIO_DIR, "../../packages/workspace"),
};

/** Texts the shipping packages do not carry, under `licenses/<component id>/`. */
const CHECKED_IN_LICENSES_DIR = path.join(STUDIO_DIR, "licenses");

// The upstream versions the checked-in texts and source pointers were taken
// for. Each is compared with what is installed when the app is packaged.
const FFMPEG_PACKAGE_VERSION = "7.1.0-rc.1";
const FFMPEG_RELEASE_TAG = "b7.1.0-rc.1";
const FFMPEG_UPSTREAM_TAG = "n7.1";
const DUGITE_NATIVE_TAG = "v2.56.0-2";
const GIT_TAG = "v2.56.0";
const MINGIT_TAG = "v2.56.0.windows.4";
const VSCODE_RIPGREP_VERSION = "1.18.0";
const RIPGREP_TAG = "15.0.0";

type PackageJson = { version: string };

/** A file copied from where the component comes from, renamed where `to` is set. */
type LicenseFile = string | { from: string; to: string };

export type ThirdPartyComponent = {
  /** Folder name under `licenses/`. */
  id: string;
  license: (platform: ElectronPlatform) => string;
  name: string;
  /** Where the component's own license files and version are read from. */
  origin:
    | { dir: string }
    | { from: keyof typeof PACKAGE_ROOTS; package: string };
  /** License files copied from the origin folder; a folder is copied whole. */
  files: LicenseFile[];
  /** Texts kept under `licenses/<id>/`. */
  checkedIn?: string[];
  /**
   * The upstream version the checked-in texts and source pointers were taken
   * for. When `installed` reads a different one, packaging fails.
   */
  pin?: { installed: (originDir: string) => string; version: string };
  /**
   * Paths under `app.asar.unpacked` this component covers, matched as
   * prefixes. Every native program and WebAssembly module there has to be
   * covered by one (verify-licenses.ts).
   */
  ships: string[];
  /** The platforms it ships on; every platform when left out. */
  platforms?: ElectronPlatform[];
  /** For a GPL program, where its source and build recipe live upstream. */
  source?: (platform: ElectronPlatform) => string[];
  version: (originDir: string) => string;
};

function packageVersion(dir: string) {
  const { version } = JSON.parse(
    readFileSync(path.join(dir, "package.json"), "utf8"),
  ) as PackageJson; // The package's own manifest, which always names a version.
  return version;
}

/** The dugite-native release dugite downloads its git build from, e.g. `v2.56.0-2`. */
function dugiteGitTag(dugiteDir: string) {
  const embedded = readFileSync(
    path.join(dugiteDir, "script", "embedded-git.json"),
    "utf8",
  );
  const tag = /\/releases\/download\/(v[^/]+)\//.exec(embedded)?.[1];
  if (!tag) {
    throw new Error(
      `Could not read the git version from ${dugiteDir}/script/embedded-git.json`,
    );
  }
  return tag;
}

export const THIRD_PARTY_COMPONENTS: ThirdPartyComponent[] = [
  {
    checkedIn: ["LICENSE.md", "COPYING.GPLv2", "COPYING.GPLv3"],
    files: [{ from: "LICENSE", to: "LICENSE.ffmpeg-ffprobe-static" }],
    id: "ffmpeg",
    // The macOS builds are configured `--enable-gpl` (GPLv2 or later, as
    // `ffmpeg -L` prints); the Linux and Windows builds add
    // `--enable-version3`, and the release ships GPLv3 as their license.
    license: (platform) =>
      platform === "darwin" ? "GPL-2.0-or-later" : "GPL-3.0-or-later",
    name: "FFmpeg (ffmpeg and ffprobe)",
    origin: { from: "workspace", package: "ffmpeg-ffprobe-static" },
    pin: { installed: packageVersion, version: FFMPEG_PACKAGE_VERSION },
    ships: ["node_modules/ffmpeg-ffprobe-static/"],
    source: (platform) => [
      `Binaries: the ffmpeg-ffprobe-static ${FFMPEG_RELEASE_TAG} release, https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/tag/${FFMPEG_RELEASE_TAG}`,
      `Build recipe: https://github.com/descriptinc/ffmpeg-ffprobe-static/blob/${FFMPEG_RELEASE_TAG}/build/index.sh, which takes the ${platformFfmpegBuilder(platform)}`,
      `FFmpeg 7.1 source: https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz (tag ${FFMPEG_UPSTREAM_TAG}, https://github.com/FFmpeg/FFmpeg/tree/${FFMPEG_UPSTREAM_TAG})`,
    ],
    version: (dir) => `7.1, from ffmpeg-ffprobe-static ${packageVersion(dir)}`,
  },
  {
    checkedIn: ["COPYING"],
    files: [{ from: "LICENSE", to: "LICENSE.dugite" }],
    id: "git",
    license: () => "GPL-2.0-only",
    name: "Git",
    origin: { from: "studio", package: "dugite" },
    pin: { installed: dugiteGitTag, version: DUGITE_NATIVE_TAG },
    ships: ["node_modules/dugite/git/"],
    source: (platform) => [
      `Build recipe: dugite-native ${DUGITE_NATIVE_TAG}, https://github.com/desktop/dugite-native/tree/${DUGITE_NATIVE_TAG}`,
      platform === "win32"
        ? `Windows build: Git for Windows MinGit ${MINGIT_TAG}, https://github.com/git-for-windows/git/releases/tag/${MINGIT_TAG}`
        : `Git source: https://github.com/git/git/tree/${GIT_TAG}`,
    ],
    version: (dir) =>
      `${dugiteGitTag(dir).slice(1)}, from dugite ${packageVersion(dir)}`,
  },
  {
    checkedIn: ["COPYING", "LICENSE-MIT", "UNLICENSE"],
    files: [{ from: "LICENSE", to: "LICENSE.vscode-ripgrep" }],
    id: "ripgrep",
    license: () => "MIT OR Unlicense",
    name: "ripgrep (rg)",
    origin: { from: "studio", package: "@vscode/ripgrep" },
    pin: { installed: packageVersion, version: VSCODE_RIPGREP_VERSION },
    ships: ["node_modules/@vscode/ripgrep"],
    version: (dir) =>
      `${RIPGREP_TAG}, from @vscode/ripgrep ${packageVersion(dir)}`,
  },
  {
    files: ["LICENSE-APACHE", "LICENSE-MIT"],
    id: "uv",
    license: () => "MIT OR Apache-2.0",
    name: "uv",
    // Vendored by scripts/download-uv.ts, which writes the version marker and
    // the license texts beside the binary.
    origin: { dir: path.join(STUDIO_DIR, "resources", "uv") },
    ships: ["resources/uv/"],
    version: (dir) =>
      readFileSync(path.join(dir, ".version"), "utf8").trim().split("-")[0] ??
      "",
  },
  {
    files: ["LICENSE.md"],
    id: "mxc",
    license: () => "MIT",
    name: "MXC launcher (wxc-exec)",
    // Vendored on Windows by scripts/download-mxc.ts, which writes the version
    // marker and the license text beside the launcher.
    origin: { dir: path.join(STUDIO_DIR, "resources", "mxc") },
    platforms: ["win32"],
    ships: ["resources/mxc/"],
    version: (dir) =>
      readFileSync(path.join(dir, ".version"), "utf8").trim().split(" ")[0] ??
      "",
  },
  {
    files: ["licenses"],
    id: "uutils",
    license: () =>
      "MIT (coreutils, findutils, grep); MIT OR Apache-2.0 (diffutils)",
    name: "uutils (coreutils, findutils' xargs, diffutils' cmp, grep)",
    // Vendored by scripts/download-uutils.ts, which writes the license texts
    // of every archive it took and the versions beside the binaries.
    origin: { dir: path.join(STUDIO_DIR, "resources", "uutils") },
    ships: ["resources/uutils/"],
    version: (dir) => readFileSync(path.join(dir, ".versions"), "utf8").trim(),
  },
  {
    files: ["LICENSE"],
    id: "pnpm",
    license: () => "MIT",
    name: "pnpm",
    origin: { from: "studio", package: "pnpm" },
    ships: ["node_modules/pnpm/"],
    version: packageVersion,
  },
  {
    files: ["LICENSE"],
    id: "agent-browser",
    license: () => "Apache-2.0",
    name: "agent-browser",
    origin: { from: "workspace", package: "agent-browser" },
    ships: ["node_modules/agent-browser/"],
    version: packageVersion,
  },
  {
    files: ["LICENSE", "LICENSE.pdfium"],
    id: "pdfium",
    license: () => "MIT AND BSD-3-Clause",
    name: "PDFium (@embedpdf/pdfium)",
    origin: { from: "studio", package: "@embedpdf/pdfium" },
    ships: ["resources/vendor/pdfium.wasm"],
    version: packageVersion,
  },
  {
    files: ["LICENSE"],
    id: "react-docx",
    license: () => "MIT",
    name: "@extend-ai/react-docx",
    origin: { from: "studio", package: "@extend-ai/react-docx" },
    ships: ["resources/vendor/docx.wasm"],
    version: packageVersion,
  },
  {
    files: ["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES"],
    id: "react-pptx",
    license: () => "MIT",
    name: "@extend-ai/react-pptx",
    origin: { from: "studio", package: "@extend-ai/react-pptx" },
    ships: ["resources/vendor/pptx.wasm"],
    version: packageVersion,
  },
  {
    files: ["LICENSE"],
    id: "react-xlsx",
    license: () => "MIT",
    name: "@extend-ai/react-xlsx",
    origin: { from: "studio", package: "@extend-ai/react-xlsx" },
    ships: ["resources/vendor/xlsx.wasm"],
    version: packageVersion,
  },
  {
    // The package names no license file; SQLite itself is public domain.
    checkedIn: ["LICENSE.txt"],
    files: [],
    id: "sqlite",
    license: () => "blessing",
    name: "SQLite (@sqlite.org/sqlite-wasm)",
    origin: { from: "studio", package: "@sqlite.org/sqlite-wasm" },
    ships: ["resources/vendor/sqlite3.wasm"],
    version: packageVersion,
  },
  {
    // The Windows installer and updater's SDK. The package names no license
    // file; the text is the repository's.
    checkedIn: ["LICENSE"],
    files: [],
    id: "velopack",
    license: () => "MIT",
    name: "Velopack (velopack)",
    origin: { from: "studio", package: "velopack" },
    ships: ["node_modules/velopack/"],
    version: packageVersion,
  },
  {
    files: ["LICENSE"],
    id: "tailwindcss-browser",
    license: () => "MIT",
    name: "@tailwindcss/browser",
    origin: { from: "studio", package: "@tailwindcss/browser" },
    ships: ["resources/tailwind-browser.js"],
    version: packageVersion,
  },
];

function platformFfmpegBuilder(platform: ElectronPlatform) {
  switch (platform) {
    case "darwin": {
      return "macOS build from osxexperts.net (https://www.osxexperts.net).";
    }
    case "linux": {
      return "Linux build from johnvansickle.com (https://johnvansickle.com/ffmpeg/).";
    }
    case "win32": {
      return "Windows build from gyan.dev (https://www.gyan.dev/ffmpeg/builds/).";
    }
  }
}

/**
 * A package's folder, found the way Node finds a bare specifier but without
 * its `exports` map, which hides `package.json` in several of these.
 */
function findPackageDir(fromDir: string, name: string) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find the ${name} package from ${fromDir}`);
    }
    dir = parent;
  }
}

function originDir(origin: ThirdPartyComponent["origin"]) {
  return "dir" in origin
    ? origin.dir
    : findPackageDir(PACKAGE_ROOTS[origin.from], origin.package);
}

type LicenseEntry = {
  folder: string;
  license: string;
  name: string;
  source: string[];
  version: string;
};

/** The README.txt that heads the folder: one section per component. */
function renderLicenseIndex(entries: LicenseEntry[]) {
  const rule = "-".repeat(72);
  const sections = entries.map((entry) =>
    [
      rule,
      entry.name,
      `Version:  ${entry.version}`,
      `License:  ${entry.license}`,
      `Texts:    ${entry.folder}/`,
      ...(entry.source.length > 0
        ? ["Source:", ...entry.source.map((line) => `  ${line}`)]
        : []),
    ].join("\n"),
  );
  return [
    `Third-party software in ${APP_NAME}`,
    "",
    `${APP_NAME} includes the programs below, each under its own license. The`,
    "folder named under each one holds its license texts.",
    `${THIRD_PARTY_NOTICES_FILE_NAME} lists the open source JavaScript packages`,
    `${APP_NAME} includes, with their licenses. Electron and Chromium's notices`,
    "ship with the app as LICENSE.electron.txt and LICENSES.chromium.html.",
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n");
}

/**
 * Write `licenses/` at `outDir`, replacing what is there. Throws when a
 * component's license file is missing or its checked-in texts were taken for
 * another version than the one installed.
 */
export function writeThirdPartyLicenses({
  checkedInDir = CHECKED_IN_LICENSES_DIR,
  components = THIRD_PARTY_COMPONENTS,
  outDir,
  platformName,
  resolveOrigin = originDir,
}: {
  checkedInDir?: string;
  components?: ThirdPartyComponent[];
  outDir: string;
  platformName: ElectronPlatform;
  resolveOrigin?: (origin: ThirdPartyComponent["origin"]) => string;
}) {
  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });

  const shipped = components.filter(
    (component) =>
      component.platforms === undefined ||
      component.platforms.includes(platformName),
  );
  const entries = shipped.map((component): LicenseEntry => {
    const dir = resolveOrigin(component.origin);
    const target = path.join(outDir, component.id);
    mkdirSync(target, { recursive: true });

    if (component.pin) {
      const installed = component.pin.installed(dir);
      if (installed !== component.pin.version) {
        throw new Error(
          `${component.name} is ${installed}, but the texts in licenses/${component.id}/ and its source pointers were taken for ${component.pin.version}. Refresh them from the new version's upstream tag and update the pin in electron-builder/third-party-licenses.ts.`,
        );
      }
    }
    for (const name of component.checkedIn ?? []) {
      copyLicenseFile(
        path.join(checkedInDir, component.id, name),
        path.join(target, name),
      );
    }
    for (const file of component.files) {
      const { from, to } =
        typeof file === "string" ? { from: file, to: file } : file;
      copyLicenseFile(path.join(dir, from), path.join(target, to));
    }

    return {
      folder: component.id,
      license: component.license(platformName),
      name: component.name,
      source: component.source?.(platformName) ?? [],
      version: component.version(dir),
    };
  });

  writeFileSync(path.join(outDir, "README.txt"), renderLicenseIndex(entries));
  return entries;
}

function copyLicenseFile(from: string, to: string) {
  if (!existsSync(from)) {
    throw new Error(`License file not found at ${from}`);
  }
  cpSync(from, to, { recursive: true });
}
