/**
 * Dev-only: forward renderer errors to the main-process dev log
 * (`apps/studio/.logs/`), where they're tagged with source "renderer".
 * Renderer processes can't write that file, so uncaught errors, unhandled
 * rejections, and explicit `logger.error` calls are otherwise invisible on
 * disk, only in the DevTools console.
 */

type RendererLogLevel = "error" | "warn";

export function forwardRendererLog(level: RendererLogLevel, args: unknown[]) {
  if (!import.meta.env.DEV) {
    return;
  }
  window.api.rendererLog?.({ args: args.map(serializeForIpc), level });
}

export function initRendererLogForwarding() {
  if (!import.meta.env.DEV) {
    return;
  }
  window.addEventListener("error", (event) => {
    forwardRendererLog("error", [
      "Uncaught error:",
      event.error ?? event.message,
    ]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    forwardRendererLog("error", ["Unhandled promise rejection:", event.reason]);
  });
}

// IPC uses structured clone, which throws on functions/DOM nodes/bigints and
// mangles Errors. Reduce each arg to a plain, clone-safe value up front.
function serializeForIpc(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { message: arg.message, name: arg.name, stack: arg.stack };
  }
  if (
    arg === null ||
    arg === undefined ||
    typeof arg === "boolean" ||
    typeof arg === "number" ||
    typeof arg === "string"
  ) {
    return arg;
  }
  try {
    return structuredClone(arg);
  } catch {
    return `[unserializable ${typeof arg}]`;
  }
}
