import type { Plugin } from "vite";

import {
  type AppFlavor,
  appFlavorOf,
  appProtocolOf,
} from "@instrument-org/shared/constants";

const LOCALHOST = ["http://localhost:*", "https://localhost:*"];

/**
 * The renderer window's Content-Security-Policy, as directive to sources.
 * `appScheme` is the one scheme this build registers and serves its own
 * files, icons, and vendored assets from, which differs per flavor.
 *
 * `img-src` is wider than anything content is allowed to reach, because it
 * also covers chrome this app drew itself. What a document written by a
 * model, a shared file, or a notebook may point an `<img>` at is decided in
 * `client/lib/image-policy.ts`; this is the backstop under it, never the
 * reason a source is safe.
 */
export function rendererContentSecurityPolicy(flavor: AppFlavor) {
  const appScheme = `${appProtocolOf(flavor)}:`;
  return {
    "connect-src": ["'self'", appScheme, ...LOCALHOST],
    "default-src": ["'self'", ...LOCALHOST],
    "font-src": ["'self'", "data:"],
    "frame-src": [
      "'self'",
      "data:",
      appScheme,
      "mailto:",
      "tel:",
      ...LOCALHOST,
    ],
    "img-src": [
      "'self'",
      "blob:",
      "data:",
      appScheme,
      "https://*.googleusercontent.com",
      "https://*.gstatic.com",
      "https://*.googleapis.com",
      "https://images.google.com",
      "https://www.google.com",
      "https://github.com",
      "https://*.github.com",
      "https://*.githubusercontent.com",
      "https://*.s3.amazonaws.com",
    ],
    "media-src": ["'self'", "data:", appScheme, ...LOCALHOST],
    "script-src": ["'self'", "'wasm-unsafe-eval'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "worker-src": ["'self'", "blob:"],
  };
}

export function serializeContentSecurityPolicy(
  policy: Record<string, string[]>,
): string {
  return Object.entries(policy)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")};`)
    .join(" ");
}

const PLACEHOLDER = '<meta http-equiv="Content-Security-Policy" />';

/**
 * Fills the policy into `index.html`'s empty CSP meta tag, for the flavor the
 * renderer bundle is built as: the same preview name, and the same `NODE_ENV`
 * Vite inlines into it (`process.env.NODE_ENV`, else the mode).
 */
export function contentSecurityPolicyMeta({
  previewName,
}: {
  previewName: string | undefined;
}): Plugin {
  let nodeEnv: string | undefined;
  return {
    configResolved(config) {
      nodeEnv = process.env.NODE_ENV || config.mode;
    },
    name: "content-security-policy-meta",
    transformIndexHtml(html) {
      if (html.split(PLACEHOLDER).length !== 2) {
        throw new Error(`index.html must hold exactly one ${PLACEHOLDER}`);
      }
      const policy = serializeContentSecurityPolicy(
        rendererContentSecurityPolicy(appFlavorOf({ nodeEnv, previewName })),
      );
      return html.replace(
        PLACEHOLDER,
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}
