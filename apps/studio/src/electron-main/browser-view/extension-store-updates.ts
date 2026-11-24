import crypto from "node:crypto";
import { z } from "zod";

import { verifyPackage } from "./extension-package";

/** The service Chrome itself asks for an extension's current package. */
const UPDATE_SERVICE = "https://update.googleapis.com/service/update2/json";

/** How long the service gets to answer. */
const ASK_TIMEOUT_MS = 30_000;

/** How long a package gets to download. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** What the service puts ahead of its JSON. */
const ANSWER_PREFIX = /^\)\]\}'\s*/;

const AnswerSchema = z.object({
  response: z.object({
    app: z.array(
      z.object({ appid: z.string(), updatecheck: z.unknown().optional() }),
    ),
  }),
});

const PackageSchema = z.object({
  manifest: z.object({
    packages: z.object({
      package: z.array(z.object({ hash_sha256: z.string(), name: z.string() })),
    }),
    version: z.string(),
  }),
  status: z.literal("ok"),
  urls: z.object({ url: z.array(z.object({ codebase: z.string() })) }),
});

/** The store's current package of an extension. */
export type StorePackage = {
  id: string;
  sha256: string;
  url: string;
  version: string;
};

/** The service's answer, read: each extension it has a package for. */
export function parseStoreAnswer(text: string): StorePackage[] {
  const answer = AnswerSchema.parse(
    JSON.parse(text.replace(ANSWER_PREFIX, "")),
  );
  return answer.response.app.flatMap(({ appid, updatecheck }) => {
    const parsed = PackageSchema.safeParse(updatecheck);
    const file = parsed.data?.manifest.packages.package[0];
    const base = parsed.data?.urls.url.find(({ codebase }) =>
      codebase.startsWith("https://"),
    );
    if (!parsed.success || !file || !base) {
      return [];
    }
    return [
      {
        id: appid,
        sha256: file.hash_sha256,
        url: new URL(file.name, base.codebase).href,
        version: parsed.data.manifest.version,
      },
    ];
  });
}

/** Asks the store for the current package of each extension. */
export async function fetchStorePackages(
  ids: readonly string[],
): Promise<StorePackage[]> {
  if (ids.length === 0) {
    return [];
  }
  const response = await fetch(UPDATE_SERVICE, {
    body: JSON.stringify({
      request: {
        "@updater": "chromecrx",
        acceptformat: "crx3",
        // With no version named, the service answers with the current
        // package whatever is installed.
        app: ids.map((appid) => ({ appid, updatecheck: {} })),
        os: {
          arch: process.arch === "ia32" ? "x86" : process.arch,
          platform:
            process.platform === "win32"
              ? "win"
              : process.platform === "darwin"
                ? "mac"
                : process.platform,
        },
        prodversion: process.versions.chrome,
        protocol: "3.1",
        requestid: crypto.randomUUID(),
        sessionid: crypto.randomUUID(),
      },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`the store's update service answered ${response.status}`);
  }
  return parseStoreAnswer(await response.text());
}

/** Downloads a package and checks it. */
export async function downloadStorePackage(
  storePackage: StorePackage,
): Promise<{ archive: Buffer; key: Buffer }> {
  const response = await fetch(storePackage.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`the store's package answered ${response.status}`);
  }
  return verifyPackage(Buffer.from(await response.arrayBuffer()), storePackage);
}

/** Orders two extension versions: up to four numbers, a missing one zero. */
export function compareExtensionVersions(a: string, b: string): number {
  const [left, right] = [a, b].map((version) => version.split(".").map(Number));
  for (let at = 0; at < 4; at += 1) {
    const difference = (left?.[at] ?? 0) - (right?.[at] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
