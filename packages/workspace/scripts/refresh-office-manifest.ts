// Pins the LibreOffice build `office` downloads: reads each platform's file
// size and SHA-256 from TDF's archive for the version given and writes them
// to src/lib/office/manifest.generated.ts. Pick the newest build on TDF's
// "still" branch that is at least two weeks old, e.g. `26.2.7.3`:
//
//   pnpm --filter @instrument-org/workspace script:refresh-office-manifest 26.2.7.3

import { writeFileSync } from "node:fs";
import path from "node:path";

import { OFFICE_ARCHIVE_URL } from "../src/lib/office/manifest";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: refresh-office-manifest <version, e.g. 26.2.7.3>");
  process.exit(1);
}

const TARGETS = {
  "darwin-arm64": { folder: "mac/aarch64", name: "MacOS_aarch64.dmg" },
  "darwin-x64": { folder: "mac/x86_64", name: "MacOS_x86-64.dmg" },
  "linux-arm64": { folder: "deb/aarch64", name: "Linux_aarch64_deb.tar.gz" },
  "linux-x64": { folder: "deb/x86_64", name: "Linux_x86-64_deb.tar.gz" },
  "win32-arm64": { folder: "win/aarch64", name: "Win_aarch64.msi" },
  "win32-x64": { folder: "win/x86_64", name: "Win_x86-64.msi" },
};

const artifacts: Record<string, unknown> = {};
for (const [target, { folder, name }] of Object.entries(TARGETS)) {
  const file = `LibreOffice_${version}_${name}`;
  const url = `${OFFICE_ARCHIVE_URL}/${version}/${folder}/${file}`;
  const head = await fetch(url, { method: "HEAD" });
  if (!head.ok) {
    throw new Error(`${url}: ${head.status}`);
  }
  const bytes = Number(head.headers.get("content-length"));
  const sums = await fetch(`${url}.sha256`);
  const sha256 = (await sums.text()).trim().split(/\s+/)[0] ?? "";
  if (!sums.ok || !/^[0-9a-f]{64}$/.test(sha256) || !(bytes > 0)) {
    throw new Error(`${url}: no size or SHA-256 (${sums.status})`);
  }
  artifacts[target] = { bytes, file, folder, sha256 };
  console.log(`${target}  ${file}  ${(bytes / 1e6).toFixed(0)} MB  ${sha256}`);
}

const out = path.resolve(
  import.meta.dirname,
  "../src/lib/office/manifest.generated.ts",
);
writeFileSync(
  out,
  `// Written by \`pnpm --filter @instrument-org/workspace script:refresh-office-manifest <version>\`.
// Sizes and hashes are TDF's own, read from its archive.

export const OFFICE_MANIFEST = ${JSON.stringify({ artifacts, version }, null, 2)} as const;
`,
);
console.log(`Wrote ${out}; run \`pnpm fix\` to format it.`);
