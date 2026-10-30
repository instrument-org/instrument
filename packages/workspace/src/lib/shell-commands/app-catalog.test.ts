import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { getAppCatalog, searchAppCatalog } from "../apps/catalog";
import { AbsolutePathSchema } from "../../schemas/paths";
import { truncateMiddle } from "../truncate-buffer";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";

const chatId = ChatIdSchema.parse("app-catalog-task");

async function catalog(...words: string[]) {
  const result = await createAppCommand({
    chatId,
    role: "chat",
    sessionId: StoreId.newSessionId(),
  }).execute(
    ["catalog", ...words],
    createCommandContext({
      cwd: "/Users/sam/chat",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
  );
  return result.stdout;
}

/**
 * The catalog as a Mac reads it. The scripted commands run only on macOS, so
 * the lines that name one are there and nowhere else.
 */
async function catalogOnMac(...words: string[]) {
  const platform = process.platform;
  Object.defineProperty(process, "platform", { value: "darwin" });
  try {
    return await catalog(...words);
  } finally {
    Object.defineProperty(process, "platform", { value: platform });
  }
}

describe("app catalog", () => {
  // The Mac's own apps are set up on the server the app ships for each, on
  // a Mac whose build carries it, and the helper's apps also need the
  // helper; anywhere else there is no way in, which the line says.
  it.each([
    [
      "apple-reminders",
      { server: true },
      "set up: none: Instrument has no way into Reminders in this build",
    ],
    [
      "apple-reminders",
      { helper: true, server: true },
      "set up: instrument app new apple-reminders --name 'Reminders' --local apple-reminders --runtime bundled, then connect_app",
    ],
    [
      "apple-mail",
      { server: true },
      "set up: instrument app new apple-mail --name 'Mail' --local apple-mail --runtime bundled, then connect_app",
    ],
    [
      "apple-notes",
      {},
      "set up: none: Instrument has no way into Notes in this build",
    ],
  ])("sets %s up as the build allows (%o)", async (slug, has, line) => {
    const config = getWorkspaceConfig();
    const {
      macAppsServer: _server,
      macHelperBinPath: _helper,
      ...without
    } = config;
    setWorkspaceConfig({
      ...without,
      ...("helper" in has && {
        macHelperBinPath: AbsolutePathSchema.parse("/app/bin/instrument-mac"),
      }),
      ...("server" in has && {
        macAppsServer: {
          args: ["/app/mac-apps.js"],
          command: "/app/Instrument",
        },
      }),
    });
    try {
      expect(await catalogOnMac(slug)).toContain(line);
    } finally {
      setWorkspaceConfig(config);
    }
  });

  it("names the MCP server as the way in when a service has one", async () => {
    const text = await catalog("linear");
    expect(text).toContain(
      "set up: instrument app new linear --name 'Linear' --mcp https://mcp.linear.app/mcp",
    );
  });

  // The set-up line used to be placeholders (--api <base-url> --auth <kind>)
  // for every service without an MCP server, which the agent filled in and
  // had refused; a keyed API gets its real base, and a service with no way in
  // that a card can open is told so rather than handed a line that cannot run.
  it("sets a keyed API up at its own base", async () => {
    const text = await catalog("github");
    expect(text).toContain(
      "set up: instrument app new github --name 'GitHub' --api https://api.github.com --auth bearer --test",
    );
    expect(text).not.toContain("<base-url>");
  });

  // A key that is not a bearer token is refused exactly like a wrong key, so
  // the entry names the placement and the set-up line carries it: WakaTime's
  // key is HTTP Basic credentials, and the bearer default spends the
  // conversation on 401s the agent has no way to read as a placement problem.
  it("carries a keyed API's own auth placement into the set-up line", async () => {
    const text = await catalog("wakatime");
    expect(text).toContain(
      "set up: instrument app new wakatime --name 'WakaTime' --api https://api.wakatime.com/api/v1 --auth basic --test",
    );
  });

  // Figma's hosted server only registers clients Figma has approved, so the
  // desktop app's own server is the way in; it wants no sign-in, and the line
  // has to say so, since an MCP app defaults to a sign-in card.
  it("puts --auth none on a keyless MCP server's line", async () => {
    const text = await catalog("figma");
    expect(text).toContain(
      "set up: instrument app new figma --name 'Figma' --mcp http://127.0.0.1:3845/mcp --auth none",
    );
  });

  // Every way in to these waits on a sign-in client the vendor has to
  // approve, so the line sets the service up on its own site instead.
  it.each([
    ["zoom", "instrument app new zoom --name 'Zoom' --web https://zoom.us"],
  ])(
    "sets %s up as a web app when every way in needs a client the card cannot make",
    async (slug, line) => {
      const text = await catalog(slug);
      expect(text).toContain(`set up: ${line} `);
      expect(text).not.toContain("<base-url>");
    },
  );

  // Each Google product is set up on its REST API with Instrument's
  // Google sign-in client.
  describe("with Google's sign-in client", () => {
    it.each([
      [
        "gmail",
        "instrument app new gmail --name 'Gmail' --api https://gmail.googleapis.com/gmail/v1 --auth oauth --test /users/me/profile",
      ],
      [
        "google-drive",
        "instrument app new google-drive --name 'Google Drive' --api https://www.googleapis.com/drive/v3 --auth oauth --test /about?fields=user",
      ],
    ])("sets %s up on its API", async (slug, line) => {
      expect(await catalog(slug)).toContain(`set up: ${line}\n`);
    });
  });

  // The listing reaches the model through a command's output, which is kept as
  // a head and a tail with the middle dropped. Every entry in full ran to 43KB
  // and came back missing everything from "consensus" to "slack", the agent's
  // own note the only sign the directory it read was a fifth of the real one.
  it("keeps every service a person browses in a listing nobody narrowed", async () => {
    const text = await catalog();
    expect(truncateMiddle(text).truncated).toBe(false);
    const listed = new Set(
      [...text.matchAll(/^ {2}(\S+) /gm)].map((match) => match[1]),
    );
    const missing = getAppCatalog()
      .filter((entry) => entry.tier !== "hidden")
      .map((entry) => entry.slug)
      .filter((slug) => !listed.has(slug));
    expect(missing).toEqual([]);
  });

  it.each([
    // A name a person calls the product by.
    ["jira", "atlassian"],
    ["excel", "onedrive"],
    ["imessage", "apple-messages"],
    ["google docs", "google-docs"],
    ["sheets", "google-sheets"],
    // A documentation server comes back when named, and only then.
    ["context7", "context7"],
  ])("answers %s with %s first", async (query, slug) => {
    expect(searchAppCatalog(query)[0]?.slug).toBe(slug);
  });

  // The vendor's name reaches every product it signs in to, ahead of any
  // service that only mentions it.
  it.each([
    [
      "google",
      [
        "gmail",
        "google-calendar",
        "google-docs",
        "google-drive",
        "google-sheets",
        "google-slides",
      ],
    ],
    ["microsoft", ["onedrive", "outlook", "teams"]],
  ])("answers %s with its products first", (query, slugs) => {
    expect(
      searchAppCatalog(query)
        .slice(0, slugs.length)
        .map((entry) => entry.slug)
        .toSorted(),
    ).toEqual(slugs);
  });

  it("keeps documentation servers out of a search that only mentions docs", () => {
    expect(
      searchAppCatalog("docs").filter((entry) => entry.tier === "hidden"),
    ).toEqual([]);
  });

  it("reaches Gmail through its API ahead of Mail on this Mac", async () => {
    const config = getWorkspaceConfig();
    setWorkspaceConfig({
      ...config,
      macAppsServer: { args: ["/app/mac-apps.js"], command: "/app/Instrument" },
    });
    try {
      expect(await catalogOnMac("gmail")).toContain(
        "set up: instrument app new gmail --name 'Gmail' --api https://gmail.googleapis.com/gmail/v1 --auth oauth --test /users/me/profile",
      );
    } finally {
      setWorkspaceConfig(config);
    }
  });

  // A query names a service, so an entry that is the thing asked for comes
  // ahead of one that mentions it: "paper" also matches Consensus, whose
  // tagline reads "read what the papers found", and used to answer with it.
  it.each(["paper", "expo", "front", "box", "make"])(
    "answers %s with the service of that name first",
    async (query) => {
      const text = await catalog(query);
      expect(text.startsWith(`${query}  `)).toBe(true);
    },
  );

  // A word like "data" matches dozens, and those in full are the same wall the
  // bare listing was.
  it("gives a broad query the detail on a few and a line for the rest", async () => {
    const text = await catalog("data");
    expect(truncateMiddle(text).truncated).toBe(false);
    expect(text).toContain('more match "data":');
  });
});
