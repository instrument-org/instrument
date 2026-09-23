import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberPageIcon, siteIconFor } from "./site-icons";

const DAY_MS = 24 * 60 * 60 * 1000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let dir: string;
let now: number;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-icons-"));
  now = Date.UTC(2026, 8, 23);
});

afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

function proxyAnswering(...answers: (() => Promise<Response>)[]) {
  return vi.fn((_url: string, _init: RequestInit) => {
    const next = answers.shift();
    if (!next) {
      throw new Error("asked the proxy more often than expected");
    }
    return next();
  });
}

const found = () =>
  Promise.resolve(
    new Response(PNG, { headers: { "content-type": "image/png" } }),
  );
const none = () => Promise.resolve(new Response(PNG, { status: 404 }));
const unreachable = () => Promise.reject(new TypeError("fetch failed"));

function deps(fetch: ReturnType<typeof proxyAnswering>) {
  return { dir, fetch, now: () => now };
}

describe("siteIconFor", () => {
  it("asks the proxy once for a host, by its origin alone, and answers from disk after", async () => {
    const fetch = proxyAnswering(found);

    expect(await siteIconFor("example.com", deps(fetch))).toEqual({
      bytes: PNG,
      type: "image/png",
    });
    expect(await siteIconFor("example.com", deps(fetch))).toEqual({
      bytes: PNG,
      type: "image/png",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toContain(
      `url=${encodeURIComponent("https://example.com")}&`,
    );
  });

  it("keeps a 404 as the site having no icon, for a week", async () => {
    const fetch = proxyAnswering(none, found);

    expect(await siteIconFor("example.com", deps(fetch))).toBeUndefined();
    now += 6 * DAY_MS;
    expect(await siteIconFor("example.com", deps(fetch))).toBeUndefined();
    now += 2 * DAY_MS;
    expect(await siteIconFor("example.com", deps(fetch))).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing when the proxy cannot be reached, and asks again next time", async () => {
    const fetch = proxyAnswering(unreachable, found);

    await expect(siteIconFor("example.com", deps(fetch))).rejects.toThrow();
    expect(await siteIconFor("example.com", deps(fetch))).toBeDefined();
  });

  it("serves a month-old copy while it fetches a fresh one", async () => {
    const fetch = proxyAnswering(found, unreachable);
    await siteIconFor("example.com", deps(fetch));

    now += 31 * DAY_MS;
    expect(await siteIconFor("example.com", deps(fetch))).toEqual({
      bytes: PNG,
      type: "image/png",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fetches once for many rows asking at the same moment", async () => {
    const fetch = proxyAnswering(found);

    await Promise.all(
      Array.from({ length: 5 }, () => siteIconFor("example.com", deps(fetch))),
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["this machine", "localhost"],
    ["a page served here", "assets.task-1.localhost"],
    ["an address", "192.168.1.4"],
    ["a path out of the folder", "../../secrets"],
  ])("asks nobody about %s", async (_name, host) => {
    const fetch = proxyAnswering();

    expect(await siteIconFor(host, deps(fetch))).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("rememberPageIcon", () => {
  const page = {
    iconUrl: "https://example.com/static/icon.svg",
    pageUrl: "https://example.com/wiki/Jar",
  };
  const svg = () =>
    Promise.resolve(
      new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
    );

  it("keeps a page's own icon for a site the proxy has none for", async () => {
    const fetch = proxyAnswering(none, svg);

    expect(await rememberPageIcon(page, deps(fetch))).toBe(true);
    expect(fetch.mock.calls[1]?.[0]).toBe(page.iconUrl);
    expect((await siteIconFor("example.com", deps(fetch)))?.type).toBe(
      "image/svg+xml",
    );
  });

  it("leaves the site alone when the proxy has its icon", async () => {
    const fetch = proxyAnswering(found);

    expect(await rememberPageIcon(page, deps(fetch))).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps the page's icon when the proxy still has none a month later", async () => {
    const fetch = proxyAnswering(none, svg, none);
    await rememberPageIcon(page, deps(fetch));

    now += 31 * DAY_MS;
    await siteIconFor("example.com", deps(fetch));
    now += 1;
    expect((await siteIconFor("example.com", deps(fetch)))?.type).toBe(
      "image/svg+xml",
    );
  });

  it("asks nothing for an icon that is not on the web", async () => {
    const fetch = proxyAnswering();

    expect(
      await rememberPageIcon(
        { ...page, iconUrl: "file:///etc/passwd" },
        deps(fetch),
      ),
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
