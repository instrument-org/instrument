import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Everything `client.ts` exports as a value is bundled into the renderer, where
 * `node:` builtins do not exist. Nothing here type-checks that: a module can
 * reach one through several hops of ordinary-looking imports, and the failure
 * lands at bundle time or, worse, at runtime in the app.
 *
 * So walk the graph the entry actually pulls in and say which hop introduced
 * the builtin, since the offending import is rarely in the file that broke.
 */
const CLIENT_ENTRY = path.join(import.meta.dirname, "client.ts");

const FROM_SPECIFIER = /\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*["'](\.[^"']+)["']/g;
// A builtin pulled in lazily is in the bundle exactly like an eager one.
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']/g;
const NODE_BUILTIN =
  /^(?:node:|fs$|os$|path$|child_process$|crypto$|worker_threads$)/;

describe("client entry", () => {
  it("reaches no node builtin", async () => {
    const offenders = await findNodeBuiltins(CLIENT_ENTRY);

    expect(offenders).toEqual([]);
  });
});

async function findNodeBuiltins(entry: string): Promise<string[]> {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue: { chain: string[]; file: string }[] = [
    { chain: [], file: entry },
  ];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || seen.has(current.file)) {
      continue;
    }
    seen.add(current.file);

    const source = await readSource(current.file);
    if (source === undefined) {
      continue;
    }

    const chain = [...current.chain, path.basename(current.file)];

    for (const { clause, specifier } of moduleEdges(source)) {
      if (isTypeOnly(clause)) {
        continue;
      }
      if (NODE_BUILTIN.test(specifier)) {
        offenders.push(`${chain.join(" -> ")} imports ${specifier}`);
        continue;
      }
      if (specifier.startsWith(".")) {
        queue.push({
          chain,
          file: path.resolve(path.dirname(current.file), specifier),
        });
      }
    }

    for (const [, specifier] of source.matchAll(SIDE_EFFECT_IMPORT)) {
      if (specifier !== undefined) {
        queue.push({
          chain,
          file: path.resolve(path.dirname(current.file), specifier),
        });
      }
    }

    for (const [, specifier] of source.matchAll(DYNAMIC_IMPORT)) {
      if (specifier === undefined) {
        continue;
      }
      if (NODE_BUILTIN.test(specifier)) {
        offenders.push(`${chain.join(" -> ")} imports ${specifier}`);
      } else if (specifier.startsWith(".")) {
        queue.push({
          chain,
          file: path.resolve(path.dirname(current.file), specifier),
        });
      }
    }
  }

  return offenders;
}

/**
 * Whether an edge is erased before bundling: `import type { X } from`, and the
 * per-specifier form this repo prefers, `import { type X, type Y } from`, which
 * only survives if at least one specifier is a value.
 */
function isTypeOnly(clause: string): boolean {
  if (/\b(?:import|export)\s+type\b/.test(clause)) {
    return true;
  }
  const braced = /\{([^}]*)\}/.exec(clause);
  if (!braced?.[1]) {
    return false;
  }
  return braced[1]
    .split(",")
    .filter((specifier) => specifier.trim() !== "")
    .every((specifier) => specifier.trim().startsWith("type "));
}

/**
 * Every `... from "specifier"` in the file, paired with the clause that
 * introduced it. Found by scanning back from the specifier to its statement
 * keyword rather than by matching the statement whole: import clauses wrap over
 * several lines, and a regex spanning them is one that backtracks badly.
 */
function moduleEdges(source: string): { clause: string; specifier: string }[] {
  const edges: { clause: string; specifier: string }[] = [];
  for (const match of source.matchAll(FROM_SPECIFIER)) {
    const specifier = match[1];
    if (specifier === undefined) {
      continue;
    }
    const before = source.slice(0, match.index);
    const start = Math.max(
      before.lastIndexOf("\nimport"),
      before.lastIndexOf("\nexport"),
    );
    // A bare `from` outside any import, e.g. inside a string.
    if (start === -1) {
      continue;
    }
    edges.push({ clause: before.slice(start), specifier });
  }
  return edges;
}

async function readSource(file: string): Promise<string | undefined> {
  for (const candidate of [`${file}.ts`, path.join(file, "index.ts"), file]) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      continue;
    }
  }
  return undefined;
}
