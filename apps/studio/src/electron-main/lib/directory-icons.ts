import { directoryIconUrl } from "@/shared/directory-icon";
import {
  DIRECTORY_ICON_FILE_PATTERN,
  DIRECTORY_ICONS_DIR_NAME,
  readDirectoryIcons,
} from "@instrument-org/workspace/electron";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const UNPACKAGED_DIRECTORY_ICONS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../packages/workspace",
  DIRECTORY_ICONS_DIR_NAME,
);

/** The directory's icons: the workspace package's folder, copied under resources once packaged. */
function getDirectoryIconsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, DIRECTORY_ICONS_DIR_NAME)
    : UNPACKAGED_DIRECTORY_ICONS_DIR;
}

let shipped: Promise<Map<string, string>> | undefined;

/** The shipped icon's file name for a slug. */
async function shippedIconFile(slug: string): Promise<string | undefined> {
  // A build without the folder draws every service from its site, as before
  // there were icons to ship.
  shipped ??= readDirectoryIcons(getDirectoryIconsDir()).catch(
    () => new Map<string, string>(),
  );
  return (await shipped).get(slug);
}

/**
 * The directory's icon for a slug, as the address the renderer draws it
 * from, when the build ships one. Drawn after an app's own icon and its Mac
 * app's, before its site's favicon.
 */
export async function directoryIconFor(
  slug: string,
): Promise<string | undefined> {
  const file = await shippedIconFile(slug);
  return file === undefined ? undefined : directoryIconUrl(file);
}

/** The directory's icon for a slug as a data address, for a page outside the window that cannot load `app:` addresses. */
export async function directoryIconDataUri(
  slug: string,
): Promise<string | undefined> {
  const file = await shippedIconFile(slug);
  if (file === undefined) {
    return undefined;
  }
  const bytes = await fs
    .readFile(path.join(getDirectoryIconsDir(), file))
    .catch(() => undefined);
  return bytes && iconDataUri(bytes, file);
}

/** An icon file's bytes as a data address, typed by its name. */
export function iconDataUri(bytes: Buffer, fileName: string): string {
  const type = fileName.endsWith(".svg") ? "image/svg+xml" : "image/png";
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/** One of the directory's icons, by its file name. */
export async function handleDirectoryIconRequest({
  request,
  url,
}: {
  request: Request;
  url: URL;
}) {
  const fileName = url.pathname.slice(1);
  if (request.method !== "GET" || !DIRECTORY_ICON_FILE_PATTERN.test(fileName)) {
    return new Response(null, { status: 404 });
  }
  try {
    const icon = await fs.readFile(path.join(getDirectoryIconsDir(), fileName));
    return new Response(icon, {
      headers: {
        // Shipped with the build, so they change only when the app does.
        "Cache-Control": "no-cache",
        ...(fileName.endsWith(".svg")
          ? {
              "Content-Security-Policy":
                "default-src 'none'; style-src 'unsafe-inline'",
              "Content-Type": "image/svg+xml",
            }
          : { "Content-Type": "image/png" }),
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
