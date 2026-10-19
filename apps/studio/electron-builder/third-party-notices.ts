// Writes `licenses/THIRD_PARTY_NOTICES.txt`: every npm package the packaged
// app carries, with its version, its declared license, and the license texts
// it ships. That is two sets, joined:
//
// - The packages Vite compiled into the main, preload, renderer and page
//   editor bundles, as recorded by bundled-packages.ts.
// - The packages in `app.asar`'s `node_modules`, which electron-builder
//   copies from the app's production dependencies, read from the archive
//   itself after it is packed.
//
// The archive drops every `.md` file under node_modules (electron-builder.ts),
// LICENSE.md included, so texts are read from the package's folder in the
// pnpm store rather than from the archive.

import { APP_NAME } from "@instrument-org/shared";
import { extractFile, listPackage } from "@electron/asar";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readBundledPackages } from "./bundled-packages";

export const THIRD_PARTY_NOTICES_FILE_NAME = "THIRD_PARTY_NOTICES.txt";

const PNPM_STORE_DIR = path.resolve(
  import.meta.dirname,
  "../../../node_modules/.pnpm",
);

/** The repo's own packages, which are not third-party. */
const FIRST_PARTY_SCOPE = "@instrument-org/";

/**
 * A license, copying or notice file at the top of a package: `LICENSE`,
 * `LICENCE.txt`, `LICENSE-MIT`, `COPYING`, `NOTICE.md`, `UNLICENSE`. Source
 * files that happen to be named `license.js` are not texts.
 */
const LICENSE_FILE =
  /^(?:licen[cs]e|copying|unlicense|notice)(?:[-._][\w.-]*)?$/i;
const NOT_A_TEXT = /\.(?:[cm]?[jt]sx?|json|map|html?)$/i;

/**
 * Declared licenses that are copyleft, rarely seen, or missing, so a person
 * looks at the package before it ships. Matched against the SPDX expression.
 */
const LICENSES_TO_REVIEW =
  /\b(?:A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|SSPL|BUSL|CC-BY-SA|CC-BY-NC)|UNKNOWN|UNLICENSED|SEE LICENSE/i;

export type PackageRef = {
  dir: string | undefined;
  name: string;
  version: string;
};

export type PackageNotice = {
  license: string;
  name: string;
  /** Each license file's text, trimmed and with Unix line endings. */
  texts: string[];
  version: string;
};

type PackageJson = {
  license?: string | { type?: string };
  licenses?: { type?: string }[] | { type?: string };
  name?: string;
  version?: string;
};

function declaredLicense(manifest: PackageJson) {
  const { license, licenses } = manifest;
  if (typeof license === "string") {
    if (license.trim()) {
      return license.trim();
    }
  } else if (license?.type) {
    return license.type;
  }
  const legacy = Array.isArray(licenses)
    ? licenses
    : licenses
      ? [licenses]
      : [];
  const types = legacy.flatMap((entry) => (entry.type ? [entry.type] : []));
  return types.length > 0 ? types.join(" OR ") : "UNKNOWN";
}

function normalizeText(text: string) {
  return text.replaceAll("\r\n", "\n").replace(/^﻿/, "").trim();
}

/**
 * The declared license and license texts of the package at `dir`. A package
 * with no folder found keeps its name and version and has no texts.
 */
export function readPackageNotice(ref: PackageRef): PackageNotice {
  const { dir } = ref;
  if (!dir) {
    return {
      license: "UNKNOWN",
      name: ref.name,
      texts: [],
      version: ref.version,
    };
  }
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "package.json"), "utf8"),
  ) as PackageJson; // The package's own manifest.
  const texts = readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        LICENSE_FILE.test(entry.name) &&
        !NOT_A_TEXT.test(entry.name),
    )
    .map((entry) => entry.name)
    .toSorted()
    .map((name) => normalizeText(readFileSync(path.join(dir, name), "utf8")))
    .filter((text) => text.length > 0);
  return {
    license: declaredLicense(manifest),
    name: ref.name,
    texts,
    version: ref.version,
  };
}

/**
 * The real folder of every package in the pnpm store, by `name@version`.
 * Each store entry's `node_modules` holds the package itself as a folder and
 * its dependencies as links, so only folders count.
 */
export function indexPnpmStore(storeDir = PNPM_STORE_DIR) {
  const index = new Map<string, string>();
  const consider = (dir: string) => {
    const file = path.join(dir, "package.json");
    if (!existsSync(file)) {
      return;
    }
    const { name, version } = JSON.parse(
      readFileSync(file, "utf8"),
    ) as PackageJson; // A package's own manifest.
    if (name && version && !index.has(`${name}@${version}`)) {
      index.set(`${name}@${version}`, dir);
    }
  };
  for (const entry of readdirSync(storeDir, { withFileTypes: true })) {
    const modules = path.join(storeDir, entry.name, "node_modules");
    if (!entry.isDirectory() || !existsSync(modules)) {
      continue;
    }
    for (const child of readdirSync(modules, { withFileTypes: true })) {
      const childDir = path.join(modules, child.name);
      if (child.isDirectory() && child.name.startsWith("@")) {
        for (const scoped of readdirSync(childDir, { withFileTypes: true })) {
          if (scoped.isDirectory()) {
            consider(path.join(childDir, scoped.name));
          }
        }
      } else if (child.isDirectory()) {
        consider(childDir);
      }
    }
  }
  return index;
}

/** A package's own manifest inside `node_modules`, at any depth. */
const PACKAGE_MANIFEST =
  /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/;

/** Every package in `node_modules` inside the archive, by name and version. */
export function listAsarPackages(asarPath: string) {
  const packages: { name: string; version: string }[] = [];
  for (const entry of listPackage(asarPath, { isPack: false })) {
    const relative = entry.replaceAll("\\", "/").replace(/^\//, "");
    if (!PACKAGE_MANIFEST.test(relative)) {
      continue;
    }
    // The archive is read in the platform's own separators, as it lists them.
    const { name, version } = JSON.parse(
      extractFile(asarPath, entry.replace(/^[\\/]/, "")).toString("utf8"),
    ) as PackageJson; // A package's own manifest.
    if (name && version) {
      packages.push({ name, version });
    }
  }
  return packages;
}

/**
 * The packages to list, one per `name@version`, without the repo's own.
 * Bundled ones already carry their folder; the archive's are found in the
 * store.
 */
export function collectPackages({
  asarPackages,
  bundled,
  store,
}: {
  asarPackages: { name: string; version: string }[];
  bundled: { dir: string; name: string; version: string }[];
  store: Map<string, string>;
}) {
  const refs = new Map<string, PackageRef>();
  for (const entry of bundled) {
    refs.set(`${entry.name}@${entry.version}`, entry);
  }
  for (const { name, version } of asarPackages) {
    const key = `${name}@${version}`;
    if (!refs.has(key)) {
      refs.set(key, { dir: store.get(key), name, version });
    }
  }
  return [...refs.values()]
    .filter((ref) => !ref.name.startsWith(FIRST_PARTY_SCOPE))
    .toSorted(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );
}

/** Packages whose declared license is copyleft, unusual or missing, or that ship no text. */
export function packagesToReview(notices: PackageNotice[]) {
  return notices.filter(
    (notice) =>
      LICENSES_TO_REVIEW.test(notice.license) || notice.texts.length === 0,
  );
}

/**
 * The notices file: an index of every package, then each distinct license
 * text once, headed by the packages that ship it.
 */
export function renderThirdPartyNotices(notices: PackageNotice[]) {
  const label = (notice: PackageNotice) => `${notice.name} ${notice.version}`;
  const groups = new Map<string, PackageNotice[]>();
  for (const notice of notices) {
    for (const text of notice.texts) {
      groups.set(text, [...(groups.get(text) ?? []), notice]);
    }
  }
  const width = Math.max(...notices.map((notice) => label(notice).length));
  const index = notices.map(
    (notice) =>
      `  ${label(notice).padEnd(width)}  ${notice.license}${notice.texts.length === 0 ? " (the package ships no license text)" : ""}`,
  );
  const heavy = "=".repeat(72);
  const light = "-".repeat(72);
  const texts = [...groups].map(([text, users]) =>
    [heavy, ...users.map(label), light, text].join("\n"),
  );
  return [
    `Third-party notices for ${APP_NAME}`,
    "",
    `${APP_NAME} includes the open source JavaScript packages below. Each is`,
    "listed with its version and declared license, and the license texts the",
    "packages ship follow the list. A text several packages share is printed",
    "once, under the names of every package that ships it.",
    "",
    `Packages (${notices.length})`,
    "",
    ...index,
    "",
    ...texts.flatMap((section) => [section, ""]),
  ].join("\n");
}

/**
 * Write the notices file for the packed app at `asarPath` into `outDir`, and
 * return what it lists and the packages to look at before shipping.
 */
export function writeThirdPartyNotices({
  asarPath,
  bundled = readBundledPackages(),
  outDir,
  store = indexPnpmStore(),
}: {
  asarPath: string;
  bundled?: { dir: string; name: string; version: string }[];
  outDir: string;
  store?: Map<string, string>;
}) {
  const notices = collectPackages({
    asarPackages: listAsarPackages(asarPath),
    bundled,
    store,
  }).map(readPackageNotice);
  const file = path.join(outDir, THIRD_PARTY_NOTICES_FILE_NAME);
  writeFileSync(file, renderThirdPartyNotices(notices));
  return { file, notices, review: packagesToReview(notices) };
}
