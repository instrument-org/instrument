/**
 * `node:crypto` shim.
 *
 * The ai-gateway barrel reaches `key-for-provider.ts`, which calls
 * `randomBytes(32).toString("hex")` while its module body runs, so this has to
 * return a working value rather than throw. Only `randomBytes` is reachable
 * from the renderer; anything else added later should fail loudly rather than
 * return something plausible.
 */
export function randomBytes(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return {
    toString(encoding?: string) {
      if (encoding !== "hex") {
        throw new Error(
          `node:crypto shim: unsupported encoding ${String(encoding)}`,
        );
      }
      return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}

export default { randomBytes };
