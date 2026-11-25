import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Deps, rememberPageIcon, siteIconFor } from "./site-icons";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

let dir: string;
let now: number;
let deps: Deps;
let fetch: ReturnType<typeof vi.fn<Deps["fetch"]>>;

/** What each address says. The service's by theme; any other, unreachable. */
let site: {
  dark?: () => Response;
  google?: () => Response;
  light?: () => Response;
  pages: Record<string, () => Response>;
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-icons-"));
  now = Date.UTC(2026, 8, 23);
  site = { pages: {} };
  fetch = vi.fn((url: string) => {
    const answer = url.startsWith("https://icons.tryinstrument.com/")
      ? site[url.endsWith("=dark") ? "dark" : "light"]
      : url.startsWith("https://t0.gstatic.com/")
        ? site.google
        : site.pages[url];
    return answer
      ? Promise.resolve(answer())
      : Promise.reject(new TypeError("fetch failed"));
  });
  deps = {
    dir,
    fetch,
    now: () => now,
    resolveHost: () => Promise.resolve(["93.184.216.34"]),
  };
});

afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

const image =
  (text: string, type = "image/png", maxAge = 7 * 24 * 60 * 60) =>
  () =>
    new Response(text, {
      headers: {
        "cache-control": `public, max-age=${maxAge}`,
        "content-type": type,
      },
    });
const none = () =>
  new Response(null, {
    headers: { "cache-control": "public, max-age=86400" },
    status: 404,
  });

const iconOf = async (
  theme: "dark" | "light" = "light",
  host = "example.com",
) => (await siteIconFor(host, theme, deps))?.bytes.toString();

/** Once the service's icon has been asked for again and its answer is kept. */
const refreshed = () =>
  vi.waitFor(async () => {
    const kept = path.join(dir, "example.com_served-light.kept.json");
    expect(JSON.parse(await fs.readFile(kept, "utf8"))).toMatchObject({
      at: now,
    });
  });

describe("siteIconFor", () => {
  it("asks the service once for each theme, by the host alone, and answers from disk after", async () => {
    site.light = image("for light");
    site.dark = image("for dark");

    expect(await iconOf()).toBe("for light");
    expect(await iconOf("dark")).toBe("for dark");
    expect(await iconOf()).toBe("for light");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://icons.tryinstrument.com/v1/example.com?theme=light",
      "https://icons.tryinstrument.com/v1/example.com?theme=dark",
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  });

  it("keeps a site having none for as long as the service says", async () => {
    site.light = none;
    expect(await iconOf()).toBeUndefined();
    expect(await iconOf()).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();

    now += 2 * DAY_MS;
    site.light = image("new");
    await iconOf();
    await refreshed();
    expect(await iconOf()).toBe("new");
  });

  it("serves a stale copy while it asks again, and keeps it when that fails", async () => {
    site.light = image("old");
    await iconOf();

    now += 8 * DAY_MS;
    site.light = undefined;
    expect(await iconOf()).toBe("old");
    expect(fetch).toHaveBeenCalledTimes(2);
    site.light = image("new");
    // The failed request is asked again once it has ended.
    await vi.waitFor(async () => {
      await iconOf();
      expect(fetch).toHaveBeenCalledTimes(3);
    });
    await refreshed();
    expect(await iconOf()).toBe("new");
  });

  it("shows Google's for minutes when the service cannot be asked", async () => {
    site.light = () => new Response(null, { status: 503 });
    site.google = image("google's");
    expect(await iconOf()).toBe("google's");

    now += 6 * MINUTE_MS;
    site.light = image("the service's");
    await iconOf();
    await refreshed();
    expect(await iconOf()).toBe("the service's");
  });

  it("keeps nothing when neither can be asked, and asks again next time", async () => {
    await expect(iconOf()).rejects.toThrow();
    site.light = image("found");
    expect(await iconOf()).toBe("found");
  });

  it("asks once for many rows asking at the same moment", async () => {
    site.light = image("found");
    await Promise.all(Array.from({ length: 5 }, () => iconOf()));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["this machine", "localhost"],
    ["a page served here", "assets.task-1.localhost"],
    ["an address", "192.168.1.4"],
    ["a name on this network", "printer.local"],
    ["a path out of the folder", "../../secrets"],
  ])("asks nobody about %s", async (_name, host) => {
    expect(await iconOf("light", host)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("rememberPageIcon", () => {
  const ICO = "https://example.com/a.ico";
  const SVG = "https://example.com/a.svg";
  const page = {
    iconUrls: [ICO, SVG],
    pageUrl: "https://example.com/wiki/Jar",
    theme: "light" as const,
  };

  it("leaves the site alone when the service has its icon", async () => {
    site.light = image("the service's");
    expect(await rememberPageIcon(page, deps)).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps a page's own for a site the service has none for, its SVG first", async () => {
    site.light = none;
    site.dark = none;
    site.pages = { [SVG]: image("svg", "image/svg+xml"), [ICO]: image("ico") };

    expect(await rememberPageIcon(page, deps)).toBe(true);
    expect(await rememberPageIcon(page, deps)).toBe(false);
    expect(await iconOf()).toBe("svg");
    expect(await iconOf("dark")).toBe("svg");
    expect(await iconOf("light", "www.example.com")).toBe("svg");
  });

  it("takes the next icon when one cannot be had", async () => {
    site.light = none;
    const pageUrl = "https://second.com/";
    const iconUrls = ["https://second.com/a.svg", "https://second.com/a.ico"];
    site.pages = { "https://second.com/a.ico": image("ico") };

    expect(await rememberPageIcon({ ...page, iconUrls, pageUrl }, deps)).toBe(
      true,
    );
    expect(await iconOf("light", "second.com")).toBe("ico");
  });

  it("gives way once the service has one", async () => {
    site.pages = { [SVG]: image("the page's", "image/svg+xml") };
    await rememberPageIcon(page, deps);
    expect(await iconOf()).toBe("the page's");

    site.light = image("the service's");
    expect(await iconOf()).toBe("the service's");
  });

  it("keeps one for a name the service cannot see, asking only the page's own host", async () => {
    const iconUrl = "https://wiki.corp.internal/a.png";
    site.pages = { [iconUrl]: image("intranet") };
    const pageUrl = "https://wiki.corp.internal/";

    expect(
      await rememberPageIcon({ ...page, iconUrls: [iconUrl], pageUrl }, deps),
    ).toBe(true);
    expect(await iconOf("light", "wiki.corp.internal")).toBe("intranet");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([iconUrl]);
  });

  it.each([
    ["not on the web", "file:///etc/passwd", ["93.184.216.34"]],
    ["not https", "http://cdn.example.com/x.png", ["93.184.216.34"]],
    ["on this computer", "https://localhost/x.png", ["127.0.0.1"]],
    ["a private address", "https://192.168.1.1/x.png", ["192.168.1.1"]],
    [
      "a name for a private address",
      "https://one.example.com/x.png",
      ["93.184.216.34", "10.0.0.2"],
    ],
    [
      "a name for a private IPv6 address",
      "https://two.example.com/x.png",
      ["fd00::1"],
    ],
    [
      "a name for a mapped private address",
      "https://three.example.com/x.png",
      ["::ffff:127.0.0.1"],
    ],
    ["a name for nothing", "https://four.example.com/x.png", []],
  ])("does not ask for an icon %s", async (_name, iconUrl, addresses) => {
    site.light = none;
    site.pages = { [iconUrl]: image("secret") };
    deps.resolveHost = () => Promise.resolve(addresses);

    expect(await rememberPageIcon({ ...page, iconUrls: [iconUrl] }, deps)).toBe(
      false,
    );
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(iconUrl);
  });

  it.each([
    ["too large", image("x".repeat(300 * 1024), "image/svg+xml")],
    ["not an image", image("<html>", "text/html")],
  ])("leaves out one that is %s", async (name, answer) => {
    site.light = none;
    const iconUrl = `https://example.com/${name.replaceAll(" ", "-")}.svg`;
    site.pages = { [iconUrl]: answer };

    expect(await rememberPageIcon({ ...page, iconUrls: [iconUrl] }, deps)).toBe(
      false,
    );
  });
});
