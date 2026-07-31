import { APP_PROTOCOL } from "@instrument-org/shared";
import { app, type NativeImage, nativeImage, protocol } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { getResourcePath } from "./resource-path";

const FILE_OPEN_ICON_HOST = "file-open-icon";
// The renderer runs from `file://` in production, where bundled assets cannot
// be fetched, so the document viewers load their engines from here instead:
// wasm binaries, the PDF worker, and the font and character-map tables those
// engines ask for by URL at parse time.
const VENDOR_HOST = "vendor";
const ICON_SIZE = 64;
const ICON_FILENAME_PATTERN = /^[a-f0-9]{64}\.png$/;
// Deliberately narrow: these paths come from the renderer, and the only ones
// that need to work are the vendored trees copied in at build time. Anything
// with a segment this rejects, `..` included, never reaches the filesystem.
const VENDOR_PATH_PATTERN = /^[\w-]+(?:\/[\w-]+)*\.[a-z0-9]+$/i;
const VENDOR_CONTENT_TYPES: Record<string, string> = {
  ".bcmap": "application/octet-stream",
  ".icc": "application/octet-stream",
  ".mjs": "text/javascript",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};
const IMMUTABLE_CACHE_SECONDS = 365 * 24 * 60 * 60;

export function registerAppProtocol() {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    switch (url.hostname) {
      case FILE_OPEN_ICON_HOST: {
        return handleFileOpenIconRequest({ request, url });
      }
      case VENDOR_HOST: {
        return handleVendorRequest({ request, url });
      }
      default: {
        return new Response(null, { status: 404 });
      }
    }
  });
}

export async function storeFileOpenIcon(base64: string) {
  if (!base64) {
    return null;
  }
  const image = nativeImage.createFromBuffer(Buffer.from(base64, "base64"));
  if (image.isEmpty()) {
    return null;
  }
  return storePng(
    image.resize({ height: ICON_SIZE, width: ICON_SIZE }).toPNG(),
  );
}

export async function storeFileOpenNativeImage(image: NativeImage) {
  if (image.isEmpty()) {
    return null;
  }
  return storePng(
    image.resize({ height: ICON_SIZE, width: ICON_SIZE }).toPNG(),
  );
}

async function handleFileOpenIconRequest({
  request,
  url,
}: {
  request: Request;
  url: URL;
}) {
  const filename = url.pathname.slice(1);
  if (request.method !== "GET" || !ICON_FILENAME_PATTERN.test(filename)) {
    return new Response(null, { status: 404 });
  }

  try {
    const icon = await fs.readFile(path.join(iconDirectory(), filename));
    return new Response(icon, {
      headers: {
        // The URL hashes the response bytes, so changed icons get a new URL.
        // This finite lifetime only bounds retention of unchanged content.
        "Cache-Control": `public, max-age=${IMMUTABLE_CACHE_SECONDS}, immutable`,
        "Content-Type": "image/png",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

async function handleVendorRequest({
  request,
  url,
}: {
  request: Request;
  url: URL;
}) {
  const assetPath = url.pathname.slice(1);
  const contentType = VENDOR_CONTENT_TYPES[path.extname(assetPath)];
  if (
    request.method !== "GET" ||
    !VENDOR_PATH_PATTERN.test(assetPath) ||
    !contentType
  ) {
    return new Response(null, { status: 404 });
  }

  try {
    const asset = await fs.readFile(getResourcePath(VENDOR_HOST, assetPath));
    return new Response(asset, {
      headers: {
        // The renderer's own origin is `file://` (or the dev server) and never
        // this scheme, so every request here is cross-origin and `fetch()`
        // would fail CORS without this. The bytes ship with the app and the
        // scheme is only reachable from the app's own web contents.
        "Access-Control-Allow-Origin": "*",
        // These ship with the app build, so they only change when the app
        // itself is replaced and the renderer is reloaded from scratch.
        "Cache-Control": `public, max-age=${IMMUTABLE_CACHE_SECONDS}, immutable`,
        "Content-Type": contentType,
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

// Icons are content-addressed and tiny (one 64px PNG per distinct app icon on
// the machine), shared across every file type that resolves to that app, so the
// store stays small in practice and is intentionally never evicted.
function iconDirectory() {
  return path.join(app.getPath("userData"), "file-open-icons");
}

// Makes concurrent temp writes of the same icon collision-free within the
// process; a leftover `.tmp` from a crash is harmless and never served.
let tempFileCounter = 0;

async function storePng(png: Buffer) {
  const digest = createHash("sha256").update(png).digest("hex");
  const filename = `${digest}.png`;
  const iconPath = path.join(iconDirectory(), filename);
  try {
    // Content addressing means an existing file already holds these exact bytes.
    await fs.access(iconPath);
  } catch {
    try {
      await fs.mkdir(iconDirectory(), { recursive: true });
      // Write to a temp path then rename so a crash mid-write, or two writers
      // racing on the same icon, can't leave a torn file at the served path.
      // Rename is atomic within a directory.
      const tempPath = path.join(
        iconDirectory(),
        `${digest}.${tempFileCounter++}.tmp`,
      );
      await fs.writeFile(tempPath, png);
      await fs.rename(tempPath, iconPath);
    } catch {
      return null;
    }
  }
  return `${APP_PROTOCOL}://${FILE_OPEN_ICON_HOST}/${filename}`;
}
