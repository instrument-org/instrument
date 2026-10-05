/**
 * Reads what changed in the official MCP Registry since a date and writes a
 * report to review against the app directory. It changes nothing: the
 * checked-in seed stays the source of truth, and every change it suggests is
 * made by hand.
 *
 * The registry's data is CC0, and its namespaces prove who owns a domain,
 * which is all it proves: thousands of domains publish servers, few of them
 * services anyone asks for. So a server is considered only when it is the
 * vendor's own (a reverse-DNS namespace whose domain hosts the endpoint, or a
 * GitHub organization a seeded entry is already known by), and a new one is
 * reported as a candidate, never added.
 *
 * Sections: seeded entries whose endpoint moved, seeded entries the registry
 * deprecated or deleted, and vendor-run servers the directory does not list.
 * The registry carries no sign of demand, so that last one runs to thousands
 * a week: counted by default, listed with --candidates for a search through it.
 *
 * Usage:
 *   pnpm --filter @instrument-org/workspace script:sync-directory-registry [--since 2026-09-27] [--out report.md] [--candidates]
 */

import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";

import { getAppCatalog } from "../src/lib/apps/catalog";

const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Hosts a vendor's endpoint may sit on while its namespace names another domain. */
const DOMAIN_ALIASES: Record<string, string> = {
  "githubcopilot.com": "github.com",
  "googleapis.com": "google.com",
};

const RowSchema = z.object({
  _meta: z.object({
    "io.modelcontextprotocol.registry/official": z.object({
      isLatest: z.boolean(),
      status: z.string(),
      updatedAt: z.string(),
    }),
  }),
  server: z.object({
    description: z.string().optional(),
    name: z.string(),
    remotes: z
      .array(z.object({ type: z.string(), url: z.string() }))
      .optional(),
    title: z.string().optional(),
  }),
});

const PageSchema = z.object({
  metadata: z.object({ nextCursor: z.string().optional() }),
  servers: z.array(RowSchema),
});

type Row = z.output<typeof RowSchema>;

const { values } = parseArgs({
  options: {
    candidates: { type: "boolean" },
    out: { type: "string" },
    since: { type: "string" },
  },
});
const since = values.since ?? new Date(Date.now() - WEEK_MS).toISOString();

const rows = await fetchSince(since);
const report = buildReport(rows);
if (values.out) {
  await fs.writeFile(values.out, report);
  console.log(
    `${rows.length} changed servers since ${since}; report at ${values.out}`,
  );
} else {
  console.log(report);
}

async function fetchSince(updatedSince: string): Promise<Row[]> {
  const found: Row[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({
      include_deleted: "true",
      limit: "100",
      updated_since: updatedSince,
      ...(cursor ? { cursor } : {}),
    });
    const page = PageSchema.parse(await fetchJson(`${REGISTRY}?${query}`));
    found.push(...page.servers);
    cursor = page.metadata.nextCursor;
  } while (cursor);
  return found.filter(
    (row) => row._meta["io.modelcontextprotocol.registry/official"].isLatest,
  );
}

/** The registry resets connections now and then, so a page is retried. */
async function fetchJson(url: string, attempt = 0): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "instrument-directory-sync" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`${response.status} for ${url}`);
    }
    return await response.json();
  } catch (error) {
    if (attempt >= 5) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    return fetchJson(url, attempt + 1);
  }
}

function buildReport(changed: Row[]): string {
  const catalog = getAppCatalog();
  const byRegistryName = new Map(
    catalog.flatMap((entry) =>
      entry.registryName ? [[entry.registryName, entry] as const] : [],
    ),
  );
  const byDomain = new Map(catalog.map((entry) => [entry.domain, entry]));
  // A GitHub organization a seeded entry is already known by vouches for
  // that organization's other servers.
  const knownOrgs = new Set(
    catalog.flatMap((entry) =>
      entry.registryName?.startsWith("io.github.")
        ? [entry.registryName.split("/")[0]]
        : [],
    ),
  );

  const moved: string[] = [];
  const gone: string[] = [];
  const candidates: string[] = [];
  for (const { _meta, server } of changed) {
    const { status } = _meta["io.modelcontextprotocol.registry/official"];
    const remote = server.remotes?.find(
      (candidate) => !candidate.url.includes("{"),
    );
    const vendorDomain = vendorDomainOf(server.name, remote?.url, knownOrgs);
    const entry =
      byRegistryName.get(server.name) ??
      (vendorDomain ? byDomain.get(vendorDomain) : undefined);
    if (entry) {
      if (status !== "active") {
        gone.push(`- **${entry.slug}** (${server.name}): ${status}`);
        continue;
      }
      const ours = entry.interfaces.find(
        (surface) => surface.format === "mcp",
      )?.endpoint;
      if (remote && withoutSlash(ours) !== withoutSlash(remote.url)) {
        moved.push(
          `- **${entry.slug}** (${server.name}): ${ours ?? "no MCP endpoint"} → ${remote.url}`,
        );
      }
      continue;
    }
    if (status === "active" && remote && vendorDomain) {
      candidates.push(
        `- **${server.title ?? server.name}** (${server.name}, ${vendorDomain}): ${remote.url}${server.description ? `. ${server.description}` : ""}`,
      );
    }
  }
  return [
    `# MCP Registry changes since ${since}`,
    "",
    `${changed.length} servers changed. Probe an endpoint before taking it, and promote a candidate only with evidence that people ask for it.`,
    "",
    "## Seeded entries whose endpoint moved",
    "",
    ...(moved.length > 0 ? moved : ["None."]),
    "",
    "## Seeded entries the registry deprecated or deleted",
    "",
    ...(gone.length > 0 ? gone : ["None."]),
    "",
    "## Vendor-run servers the directory does not list",
    "",
    ...(candidates.length === 0
      ? ["None."]
      : values.candidates
        ? candidates
        : [
            `${candidates.length}. Run with --candidates to list them, then look for the ones people ask for by name.`,
          ]),
    "",
  ].join("\n");
}

/**
 * The vendor's domain when the server is the vendor's own: a reverse-DNS
 * namespace (`com.atlassian/...`) whose domain hosts the endpoint, or a
 * GitHub organization a seeded entry is known by. Undefined otherwise.
 */
function vendorDomainOf(
  name: string,
  url: string | undefined,
  knownOrgs: Set<string | undefined>,
): string | undefined {
  const namespace = name.split("/")[0] ?? "";
  if (!url || !URL.canParse(url)) {
    return undefined;
  }
  const host = new URL(url).hostname;
  if (namespace.startsWith("io.github.")) {
    return knownOrgs.has(namespace) ? siteOf(host) : undefined;
  }
  const domain = namespace.split(".").toReversed().join(".");
  const site = siteOf(host);
  return site === domain || DOMAIN_ALIASES[site] === domain
    ? domain
    : undefined;
}

/** The host's last two labels, which is the registrable domain for the vendors this reads. */
function siteOf(host: string): string {
  return host.split(".").slice(-2).join(".");
}

function withoutSlash(url: string | undefined): string | undefined {
  return url?.replace(/\/+$/, "");
}
