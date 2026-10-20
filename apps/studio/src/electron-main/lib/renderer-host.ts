import { APP_PROTOCOL } from "@instrument-org/shared";
import path from "node:path";

/**
 * The host the built renderer is served from on the app scheme
 * (`app-protocol.ts`), which makes `<scheme>://app` the renderer's origin.
 */
export const RENDERER_HOST = "app";

/** The folder the built renderer is in, beside the main bundle. */
export function rendererDir() {
  return path.join(import.meta.dirname, "../renderer");
}

/** Where the renderer's own files are served from: the dev server, or the app scheme. */
export function rendererBaseURL() {
  return process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL.replace(/\/?$/, "/")
    : `${APP_PROTOCOL}://${RENDERER_HOST}/`;
}
