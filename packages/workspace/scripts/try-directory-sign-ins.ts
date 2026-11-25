/**
 * Asks services whether they would let Instrument sign in, by starting the
 * sign-in the app starts and stopping before the page a person approves. A
 * server's metadata says only that it registers clients, which is all
 * `probe-app-directory` reads; some then refuse any client they have not
 * approved, and only asking tells. Nothing is signed in to and nothing needs
 * a person.
 *
 * Each service that accepts keeps a client named Instrument, one more each
 * run, unless it offers to take it back, so it names the services to ask:
 * `--only` and `--endpoint` for some, `--all` for every one the directory
 * signs in to this way.
 *
 * Usage:
 *   pnpm --filter @instrument-org/workspace script:try-directory-sign-ins (--only <slug>,<slug> | --endpoint <url> | --all) [--json]
 */

import { parseArgs } from "node:util";

import { getAppCatalog } from "../src/lib/apps/catalog";
import { type SignInAttempt, trySignIn } from "./lib/try-sign-in";

const CONCURRENCY = 4;

const { values } = parseArgs({
  options: {
    all: { type: "boolean" },
    endpoint: { multiple: true, type: "string" },
    json: { type: "boolean" },
    only: { type: "string" },
  },
});

const only = values.only?.split(",").map((slug) => slug.trim());
if (!values.all && only === undefined && values.endpoint === undefined) {
  console.error("Name the services to ask: --only, --endpoint or --all.");
  process.exit(1);
}

const targets = [
  ...getAppCatalog()
    .filter((entry) => values.all === true || only?.includes(entry.slug))
    .flatMap((entry) =>
      entry.interfaces.flatMap((surface) =>
        surface.format === "mcp" &&
        (surface.auth === "oauth" || surface.clientDocument === true) &&
        surface.endpoint !== undefined
          ? [{ endpoint: surface.endpoint, name: entry.slug }]
          : [],
      ),
    ),
  ...(values.endpoint ?? []).map((endpoint) => ({ endpoint, name: endpoint })),
];

const rows: { attempt: SignInAttempt; endpoint: string; name: string }[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < targets.length) {
      const target = targets[next++];
      if (target) {
        rows.push({ ...target, attempt: await trySignIn(target.endpoint) });
      }
    }
  }),
);
rows.sort((a, b) => a.name.localeCompare(b.name));

if (values.json) {
  console.log(JSON.stringify(rows));
} else {
  for (const kind of ["refused", "failed", "open", "accepted"] as const) {
    const of = rows.filter((row) => row.attempt.kind === kind);
    console.log(`\n${kind} (${String(of.length)}):`);
    console.log(of.map(line).join("\n") || "  none");
  }
}

function line({ attempt, name }: (typeof rows)[number]): string {
  switch (attempt.kind) {
    case "accepted": {
      return `  ${name}  ${attempt.removed ? "registration removed" : "registration left there"}`;
    }
    case "failed": {
      return `  ${name}  ${attempt.said}`;
    }
    case "open": {
      return `  ${name}`;
    }
    case "refused": {
      return `  ${name}  HTTP ${String(attempt.status)} ${attempt.error ?? ""} ${attempt.said ?? ""}`;
    }
  }
}
