import { APP_PROTOCOL } from "@instrument-org/shared";
import path from "node:path";

/**
 * The host the built renderer is served from on the app scheme
 * (`app-protocol.ts`), which makes `<scheme>://app` the renderer's origin.
 */
export const RENDERER_HOST = "app";

/**
 * Sent with the renderer's pages so that when a window stops responding, main
 * can read what its JavaScript was running (`collectJavaScriptCallStack`);
 * Chromium hands the stack only to a page that opted in. The dev server sends
 * the same header (`electron.vite.config.ts`).
 */
export const RENDERER_DOCUMENT_POLICY = {
  "Document-Policy": "include-js-call-stacks-in-crash-reports",
};

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
