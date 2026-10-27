import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { serveRegisteredClient } from "../../test/helpers/serve-registered-client";
import {
  getAppCatalog,
  resetServedAppCatalog,
  searchAppCatalog,
} from "../apps/catalog";
import { AbsolutePathSchema } from "../../schemas/paths";
import { truncateMiddle } from "../truncate-buffer";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";

const chatId = ChatIdSchema.parse("app-catalog-task");

async function catalog(...words: string[]) {
  const result = await createAppCommand({
    chatId,
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
  // The helper is the only way into Reminders, so a build without it says
  // there is none rather than naming a command it lacks.
  it.each([
    [
      undefined,
      "set up: none: Instrument has no way into Reminders in this build",
    ],
    ["/app/bin/instrument-mac", "do it with the `instrument calendar` command"],
  ])("sends Reminders through the helper when it is %s", async (bin, line) => {
    const config = getWorkspaceConfig();
    const { macHelperBinPath: _absent, ...without } = config;
    setWorkspaceConfig(
      bin === undefined
        ? without
        : { ...config, macHelperBinPath: AbsolutePathSchema.parse(bin) },
    );
    try {
      expect(await catalog("apple-reminders")).toContain(line);
    } finally {
      setWorkspaceConfig(config);
    }
  });

  it.each([
    ["apple-mail", "instrument mail"],
    ["apple-notes", "instrument notes"],
    ["apple-messages", "instrument messages"],
  ])("sends %s through the `%s` command on a Mac", async (slug, command) => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    try {
      expect(await catalog(slug)).toContain(
        `do it with the \`${command}\` command`,
      );
    } finally {
      vi.unstubAllGlobals();
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
    [
      "google-drive",
      "instrument app new google-drive --name 'Google Drive' --web https://drive.google.com",
    ],
    ["zoom", "instrument app new zoom --name 'Zoom' --web https://zoom.us"],
  ])(
    "sets %s up as a web app when every way in needs a client the card cannot make",
    async (slug, line) => {
      const text = await catalog(slug);
      expect(text).toContain(`set up: ${line} `);
      expect(text).not.toContain("<base-url>");
    },
  );

  // Google's sign-in client is served only to admins, and for them each
  // Google product is set up on its REST API with a sign-in.
  describe("with Google's sign-in client", () => {
    afterEach(resetServedAppCatalog);

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
      serveRegisteredClient(slug, "google-client");
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

  it("works the Mac's own apps with nothing to connect", async () => {
    const text = await catalogOnMac("apple notes");
    expect(text).toContain("set up: nothing to connect");
    expect(text).not.toContain("account is added");
  });

  it("reaches Gmail through Mail until its sign-in client clears", async () => {
    const text = await catalogOnMac("gmail");
    expect(text).toContain(
      "set up: nothing to connect, and no `instrument app new`: when the user asks for something in Mail",
    );
    expect(text).toContain("only when its account is added to Mail");
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
