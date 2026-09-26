import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker, type WorkerOptions } from "node:worker_threads";

const require = createRequire(import.meta.url);

// The ESM half of tsx's API, found through the CJS one beside it, since
// `require.resolve` only sees the `require` condition.
const tsxApi = pathToFileURL(
  path.join(path.dirname(require.resolve("tsx/esm/api")), "index.mjs"),
).href;
const defineGlobals = new URL(
  "../../../scripts/lib/define-globals-apply.ts",
  import.meta.url,
).href;
const entry = new URL("../../lib/bash-worker/entry.ts", import.meta.url).href;

/**
 * Starts the bash worker from source, for tests and scripts: tsx compiles it,
 * and the build-time globals Studio's bundler defines are assigned first.
 */
export function createTsxBashWorker(options: WorkerOptions): Worker {
  const bootstrap = [
    `import { register } from ${JSON.stringify(tsxApi)};`,
    "register();",
    `await import(${JSON.stringify(defineGlobals)});`,
    `await import(${JSON.stringify(entry)});`,
  ].join("\n");
  return new Worker(
    new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`),
    options,
  );
}
