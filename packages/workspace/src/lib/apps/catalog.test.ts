import { afterEach, describe, expect, it } from "vitest";

import { serveRegisteredClient } from "../../test/helpers/serve-registered-client";
import {
  appCatalogEntriesHash,
  catalogApiSignInClient,
  builtInAppCatalogRevision,
  catalogEntryAt,
  catalogEntryForApp,
  catalogEndpointNeedsClient,
  catalogRegisteredClient,
  getAppCatalog,
  resetServedAppCatalog,
  applyServedAppCatalog,
} from "./catalog";
import seed from "./catalog-seed.json";
import { catalogWayIn } from "./way-in";

describe("catalogEntryAt", () => {
  it.each([
    ["https://mail.google.com", "gmail"],
    ["https://mail.google.com/mail/u/1/", "gmail"],
    ["https://mail.google.com/mail/?authuser=jeremy%40example.com", "gmail"],
    ["https://calendar.google.com/calendar/r", "google-calendar"],
    ["https://docs.google.com/document/d/abc/edit", "google-docs"],
    ["https://docs.google.com/spreadsheets/d/abc/edit", "google-sheets"],
    ["https://docs.google.com/presentation/d/abc/edit", "google-slides"],
    ["https://docs.google.com/forms/d/abc/edit", undefined],
    ["https://example.invalid/", undefined],
  ])("finds %s as %s", (address, slug) => {
    expect(catalogEntryAt(address)?.slug).toBe(slug);
  });
});

describe("catalogEntryForApp", () => {
  it("finds a second account by the site it is on, whatever its slug", () => {
    expect(
      catalogEntryForApp("gmail-personal", {
        type: "web",
        url: "https://mail.google.com/mail/u/1/",
      })?.slug,
    ).toBe("gmail");
  });

  it("takes the service a manifest names over its slug", () => {
    expect(
      catalogEntryForApp("notion", { service: "gmail", type: "web" })?.slug,
    ).toBe("gmail");
  });
});

describe("a Google product the directory gives no client", () => {
  // The client is served only to admins; the seed says how its sign-in goes.
  it.each([
    "https://gmailmcp.googleapis.com/mcp/v1",
    "https://calendarmcp.googleapis.com/mcp/v1",
    "https://drivemcp.googleapis.com/mcp/v1",
    "https://docsmcp.googleapis.com/mcp/v1",
    "https://sheetsmcp.googleapis.com/mcp/v1",
    "https://slidesmcp.googleapis.com/mcp/v1",
  ])("still needs a client at %s", (endpoint) => {
    expect(catalogEndpointNeedsClient(endpoint)).toBe(true);
    expect(catalogRegisteredClient(endpoint)).toBeUndefined();
  });
});

describe("HubSpot's and Asana's MCP sign-in", () => {
  const servers = [
    ["hubspot", "https://mcp.hubspot.com"],
    ["asana", "https://mcp.asana.com/v2/mcp"],
  ] as const;
  const entry = (slug: string) => {
    const found = getAppCatalog().find((candidate) => candidate.slug === slug);
    if (!found) {
      throw new Error(`No ${slug} in the directory`);
    }
    return found;
  };

  afterEach(() => {
    resetServedAppCatalog();
  });

  // HubSpot's client is served only to admins; everyone else keeps the web.
  it("leaves hubspot off its MCP server without the client", () => {
    expect(catalogEndpointNeedsClient("https://mcp.hubspot.com")).toBe(true);
    expect(catalogRegisteredClient("https://mcp.hubspot.com")).toBeUndefined();
    expect(catalogWayIn(entry("hubspot")).kind).toBe("web");
  });

  it("signs asana in to its MCP server with the directory's own client", () => {
    expect(catalogWayIn(entry("asana"))).toMatchObject({
      endpoint: "https://mcp.asana.com/v2/mcp",
      kind: "mcp",
    });
    expect(
      catalogRegisteredClient("https://mcp.asana.com/v2/mcp"),
    ).toMatchObject({ clientId: "1219780662598165", tokenExchange: "api" });
  });

  it.each(servers)(
    "signs %s in to its MCP server with the client and the API token route",
    (slug, endpoint) => {
      serveRegisteredClient(slug, `${slug}-client`);
      expect(catalogWayIn(entry(slug))).toMatchObject({
        endpoint,
        kind: "mcp",
      });
      expect(catalogRegisteredClient(endpoint)).toEqual({
        authorizationParams: undefined,
        clientId: `${slug}-client`,
        scope: undefined,
        service: slug,
        tokenExchange: "api",
      });
    },
  );
});

describe("Microsoft Graph's sign-in", () => {
  const graph = "https://graph.microsoft.com/v1.0";
  const entry = (slug: string) => {
    const found = getAppCatalog().find((candidate) => candidate.slug === slug);
    if (!found) {
      throw new Error(`No ${slug} in the directory`);
    }
    return found;
  };

  afterEach(() => {
    resetServedAppCatalog();
  });

  // Teams' client is served only to admins; everyone else keeps the web.
  it("leaves teams on the web without the client", () => {
    expect(catalogWayIn(entry("teams")).kind).toBe("web");
    expect(
      catalogApiSignInClient("teams", {
        service: "teams",
        type: "api",
        url: graph,
      }),
    ).toBeUndefined();
  });

  it.each(["outlook", "onedrive"])(
    "signs %s in to Graph with the directory's own client",
    (slug) => {
      expect(catalogWayIn(entry(slug)).kind).toBe("api");
      expect(
        catalogApiSignInClient(slug, {
          service: slug,
          type: "api",
          url: graph,
        })?.clientId,
      ).toBe("eb827d4c-f05a-4857-be47-496124fa5c50");
    },
  );

  it.each(["outlook", "onedrive", "teams"])(
    "signs %s in to Graph with the client",
    (slug) => {
      serveRegisteredClient(slug, "microsoft-client");
      expect(catalogWayIn(entry(slug))).toEqual({
        auth: "oauth",
        endpoint: graph,
        kind: "api",
        test: "/me",
      });
    },
  );

  it("gives each product of one API its own scopes and relay route", () => {
    serveRegisteredClient(["outlook", "onedrive", "teams"], "microsoft-client");
    const signIns = ["outlook", "onedrive", "teams"].map((service) =>
      catalogApiSignInClient(`${service}-2`, {
        service,
        type: "api",
        url: `${graph}/`,
      }),
    );
    expect(signIns).toMatchInlineSnapshot(`
      [
        {
          "authorizationEndpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
          "authorizationParams": {
            "prompt": "select_account",
          },
          "clientId": "microsoft-client",
          "scope": "offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite",
          "service": "outlook",
        },
        {
          "authorizationEndpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
          "authorizationParams": {
            "prompt": "select_account",
          },
          "clientId": "microsoft-client",
          "scope": "offline_access User.Read Files.ReadWrite.All",
          "service": "onedrive",
        },
        {
          "authorizationEndpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
          "authorizationParams": {
            "prompt": "select_account",
          },
          "clientId": "microsoft-client",
          "scope": "offline_access User.Read Chat.ReadWrite ChatMessage.Send Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Send",
          "service": "teams",
        },
      ]
    `);
  });
});

describe("the seed's revision", () => {
  it("moves whenever the entries change", () => {
    expect(
      appCatalogEntriesHash(seed.entries),
      "The directory's entries changed: run `pnpm --filter @instrument-org/workspace script:stamp-app-catalog`.",
    ).toBe(seed.entriesHash);
  });
});

describe("applyServedAppCatalog", () => {
  afterEach(resetServedAppCatalog);

  const later = new Date(
    Date.parse(builtInAppCatalogRevision()) + 1000,
  ).toISOString();
  const slack = seed.entries.find((entry) => entry.slug === "slack");

  it("uses a served directory as new as the built-in one", () => {
    expect(
      applyServedAppCatalog({
        entries: [{ ...slack, tagline: "Served." }],
        entriesHash: "",
        revision: later,
      }),
    ).toBe("used");
    expect(getAppCatalog().map((entry) => entry.tagline)).toEqual(["Served."]);
  });

  it("refuses one older than the built-in, which would undo it", () => {
    expect(
      applyServedAppCatalog({
        entries: [slack],
        entriesHash: "",
        revision: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("older");
    expect(getAppCatalog()).toHaveLength(seed.entries.length);
  });

  it("keeps the built-in entry for one this build cannot read, and drops one it has no copy of", () => {
    expect(
      applyServedAppCatalog({
        entries: [
          { ...slack, category: "a-category-from-later" },
          { slug: "unknown-later", tier: "featured" },
        ],
        entriesHash: "",
        revision: later,
      }),
    ).toBe("used");
    expect(getAppCatalog().map((entry) => entry.category)).toEqual([
      slack?.category,
    ]);
  });

  it.each([
    [{}],
    [{ entries: [], entriesHash: "", revision: later }],
    ["<html>"],
  ])("refuses %j", (document) => {
    expect(applyServedAppCatalog(document)).toBe("unreadable");
    expect(getAppCatalog()).toHaveLength(seed.entries.length);
  });
});
