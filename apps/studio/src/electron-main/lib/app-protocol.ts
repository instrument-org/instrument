import { APP_PROTOCOL } from "@instrument-org/shared";
import { app, type NativeImage, nativeImage, protocol } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const FILE_OPEN_ICON_HOST = "file-open-icon";
const ICON_SIZE = 64;
const ICON_FILENAME_PATTERN = /^[a-f0-9]{64}\.png$/;
const IMMUTABLE_CACHE_SECONDS = 365 * 24 * 60 * 60;

export function registerAppProtocol() {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    switch (url.hostname) {
      case FILE_OPEN_ICON_HOST: {
        return handleFileOpenIconRequest({ request, url });
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
