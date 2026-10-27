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

describe("Google's REST APIs", () => {
  const apis = [
    ["gmail", "https://gmail.googleapis.com/gmail/v1", "/users/me/profile"],
    [
      "google-calendar",
      "https://www.googleapis.com/calendar/v3",
      "/users/me/calendarList?maxResults=1",
    ],
    [
      "google-drive",
      "https://www.googleapis.com/drive/v3",
      "/about?fields=user",
    ],
    [
      "google-docs",
      "https://docs.googleapis.com/v1",
      "/documents/195j9eDD3ccgjQRttHhJPymLJUCOUjs-jmwTrekvdjFE",
    ],
    [
      "google-sheets",
      "https://sheets.googleapis.com/v4",
      "/spreadsheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    ],
    [
      "google-slides",
      "https://slides.googleapis.com/v1",
      "/presentations/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc",
    ],
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

  // The client is served only to admins; the seed says how its sign-in goes.
  it.each(apis)(
    "leaves %s off its API without the client",
    (slug, endpoint) => {
      expect(catalogWayIn(entry(slug)).kind).not.toBe("api");
      expect(catalogEndpointNeedsClient(endpoint)).toBe(true);
      expect(
        catalogApiSignInClient(slug, {
          service: slug,
          type: "api",
          url: endpoint,
        }),
      ).toBeUndefined();
    },
  );

  it.each(apis)(
    "signs %s in to its API with the client",
    (slug, endpoint, test) => {
      serveRegisteredClient(slug, "google-client");
      expect(catalogWayIn(entry(slug))).toEqual({
        auth: "oauth",
        endpoint,
        kind: "api",
        test,
      });
    },
  );

  it("asks Google for each product's own scopes and a refresh token", () => {
    const slugs = apis.map(([slug]) => slug);
    serveRegisteredClient(slugs, "google-client");
    expect(
      apis.map(([slug, url]) =>
        catalogApiSignInClient(slug, { service: slug, type: "api", url }),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "authorizationEndpoint": "https://accounts.google.com/o/oauth2/v2/auth",
          "authorizationParams": {
            "access_type": "offline",
            "prompt": "consent",
          },
          "clientId": "google-client",
          "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
          "service": "gmail",
        },
        {
          "authorizationEndpoint": "https://accounts.google.com/o/oauth2/v2/auth",
          "authorizationParams": {
            "access_type": "offline",
            "prompt": "consent",
          },
          "clientId": "google-client",
          "scope": "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy",
          "service": "google-calendar",
        },
        {
          "authorizationEndpoint": "https://accounts.google.com/o/oauth2/v2/auth",
          "authorizationParams": {
            "access_type": "offline",
            "prompt": "consent",
          },
          "clientId": "google-client",
          "scope": "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file",
          "service": "google-drive",
        },
        {
          "authorizationEndpoint": "https://accounts.google.com/o/oauth2/v2/auth",
          "authorizationParams": {
            "access_type": "offline",
            "prompt": "consent",
          },
          "clientId": "google-client",
          "scope": "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/documents",
          "service": "google-docs",
        },
        {
          "authorizationEndpoint": "https://accounts.google.com/o/oauth2/v2/auth",
          "authorizationParams": {
            "access_type": "offline",
            "prompt": "consent",
          },
          "clientId": "google-client",
          "scope": "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets",
          "service": "google-sheets",
        },
        {
          "authorizationEndpoint": "https://accounts.google.com/o/oauth2/v2/auth",
          "authorizationParams": {
            "access_type": "offline",
            "prompt": "consent",
          },
          "clientId": "google-client",
          "scope": "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/presentations",
          "service": "google-slides",
        },
      ]
    `);
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

  it.each([
    [
      "hubspot",
      "https://mcp.hubspot.com",
      "a91d9efc-35bf-45ce-b216-da9315e324c4",
    ],
    ["asana", "https://mcp.asana.com/v2/mcp", "1219780662598165"],
  ])(
    "signs %s in to its MCP server with the directory's own client",
    (slug, endpoint, clientId) => {
      expect(catalogWayIn(entry(slug))).toMatchObject({
        endpoint,
        kind: "mcp",
      });
      expect(catalogRegisteredClient(endpoint)).toMatchObject({
        clientId,
        tokenExchange: "api",
      });
    },
  );

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
