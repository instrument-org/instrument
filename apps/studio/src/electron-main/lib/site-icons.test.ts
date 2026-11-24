import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Deps, rememberPageIcon, siteIconFor } from "./site-icons";

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

function deps(
  fetch: ReturnType<typeof proxyAnswering>,
  overrides: Partial<Deps> = {},
): Deps {
  return {
    dir,
    fetch,
    isLegible: () => Promise.resolve(true),
    now: () => now,
    resolveHost: () => Promise.resolve(["93.184.216.34"]),
    ...overrides,
  };
}

describe("siteIconFor", () => {
  it("asks the proxy once for a host, by its origin alone, and answers from disk after", async () => {
    const fetch = proxyAnswering(found);

    expect(await siteIconFor("example.com", "light", deps(fetch))).toEqual({
      bytes: PNG,
      type: "image/png",
    });
    expect(await siteIconFor("example.com", "light", deps(fetch))).toEqual({
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

    expect(
      await siteIconFor("example.com", "light", deps(fetch)),
    ).toBeUndefined();
    now += 6 * DAY_MS;
    expect(
      await siteIconFor("example.com", "light", deps(fetch)),
    ).toBeUndefined();
    now += 2 * DAY_MS;
    expect(
      await siteIconFor("example.com", "light", deps(fetch)),
    ).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing when the proxy cannot be reached, and asks again next time", async () => {
    const fetch = proxyAnswering(unreachable, found);

    await expect(
      siteIconFor("example.com", "light", deps(fetch)),
    ).rejects.toThrow();
    expect(
      await siteIconFor("example.com", "light", deps(fetch)),
    ).toBeDefined();
  });

  it("serves a month-old copy while it fetches a fresh one", async () => {
    const fetch = proxyAnswering(found, unreachable);
    await siteIconFor("example.com", "light", deps(fetch));

    now += 31 * DAY_MS;
    expect(await siteIconFor("example.com", "light", deps(fetch))).toEqual({
      bytes: PNG,
      type: "image/png",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fetches once for many rows asking at the same moment", async () => {
    const fetch = proxyAnswering(found);

    await Promise.all(
      Array.from({ length: 5 }, () =>
        siteIconFor("example.com", "light", deps(fetch)),
      ),
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

    expect(await siteIconFor(host, "light", deps(fetch))).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("rememberPageIcon", () => {
  const page = {
    iconUrls: ["https://example.com/static/icon.ico"],
    pageUrl: "https://example.com/wiki/Jar",
    theme: "light" as const,
  };
  const ico = () =>
    Promise.resolve(
      new Response(PNG, { headers: { "content-type": "image/x-icon" } }),
    );

  it("keeps a page's own icon for a site the proxy has none for", async () => {
    const fetch = proxyAnswering(none, ico);

    expect(await rememberPageIcon(page, deps(fetch))).toBe(true);
    expect(fetch.mock.calls[1]?.[0]).toBe(page.iconUrls[0]);
    const icon = await siteIconFor("example.com", "light", deps(fetch));
    expect(icon?.type).toBe("image/x-icon");
  });

  it("leaves the site alone when the proxy has its icon", async () => {
    const fetch = proxyAnswering(found);

    expect(await rememberPageIcon(page, deps(fetch))).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps the page's icon when the proxy still has none a month later", async () => {
    const fetch = proxyAnswering(none, ico, none);
    await rememberPageIcon(page, deps(fetch));

    now += 31 * DAY_MS;
    await siteIconFor("example.com", "light", deps(fetch));
    now += 1;
    const icon = await siteIconFor("example.com", "light", deps(fetch));
    expect(icon?.type).toBe("image/x-icon");
  });

  it("asks nothing for an icon that is not on the web", async () => {
    const fetch = proxyAnswering();

    expect(
      await rememberPageIcon(
        { ...page, iconUrls: ["file:///etc/passwd"] },
        deps(fetch),
      ),
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

const svgOf = (text: string) => () =>
  Promise.resolve(
    new Response(text, { headers: { "content-type": "image/svg+xml" } }),
  );

describe("the SVG the proxy's bitmap was made from", () => {
  const ORIGIN = "https://cdn.example.com/favicon.svg";
  const madeFrom = (origin: string) => () =>
    Promise.resolve(
      new Response(PNG, {
        headers: { "content-location": origin, "content-type": "image/png" },
      }),
    );
  const typeFor = async (d: Deps, theme: "dark" | "light" = "light") =>
    (await siteIconFor("example.com", theme, d))?.type;

  it("is served in the bitmap's place, asked for with nothing of the person's", async () => {
    const fetch = proxyAnswering(madeFrom(ORIGIN), svgOf("<svg/>"));

    expect(await typeFor(deps(fetch))).toBe("image/svg+xml");
    expect(await typeFor(deps(fetch))).toBe("image/svg+xml");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  it("gives way to the bitmap in a theme it cannot be seen in, measured once", async () => {
    const fetch = proxyAnswering(madeFrom(ORIGIN), svgOf("<svg/>"));
    const isLegible = vi.fn<Deps["isLegible"]>((_svg, theme) =>
      Promise.resolve(theme === "light"),
    );
    const d = deps(fetch, { isLegible });

    expect(await typeFor(d, "dark")).toBe("image/png");
    expect(await typeFor(d, "dark")).toBe("image/png");
    expect(await typeFor(d, "light")).toBe("image/svg+xml");
    expect(isLegible).toHaveBeenCalledTimes(2);
  });

  it("is measured again when it could not be", async () => {
    const fetch = proxyAnswering(madeFrom(ORIGIN), svgOf("<svg/>"));
    const isLegible = vi
      .fn<Deps["isLegible"]>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true);
    const d = deps(fetch, { isLegible });

    expect(await typeFor(d)).toBe("image/png");
    expect(await typeFor(d)).toBe("image/svg+xml");
  });

  it.each([
    ["not https", "http://example.com/favicon.svg", ["93.184.216.34"]],
    ["on this computer", "https://localhost/favicon.svg", ["127.0.0.1"]],
    ["a private address", "https://192.168.1.1/favicon.svg", ["192.168.1.1"]],
    ["a name for a private address", ORIGIN, ["93.184.216.34", "10.0.0.2"]],
    ["a name for a private IPv6 address", ORIGIN, ["fd00::1"]],
    ["a name for a mapped private address", ORIGIN, ["::ffff:127.0.0.1"]],
    ["a name for nothing", ORIGIN, []],
  ])("is not asked for when it is %s", async (_name, origin, addresses) => {
    const fetch = proxyAnswering(madeFrom(origin));
    const d = deps(fetch, { resolveHost: () => Promise.resolve(addresses) });

    expect(await typeFor(d)).toBe("image/png");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["too large", svgOf("x".repeat(300 * 1024))],
    ["not an SVG", found],
    ["unreachable", unreachable],
  ])("is left out when it is %s", async (_name, answer) => {
    const fetch = proxyAnswering(madeFrom(ORIGIN), answer);

    expect(await typeFor(deps(fetch))).toBe("image/png");
  });
});

describe("the SVG a page names for itself", () => {
  const page = {
    iconUrls: ["https://example.com/a.ico", "https://example.com/a.svg"],
    pageUrl: "https://example.com/",
    theme: "dark" as const,
  };
  const textFor = async (d: Deps, theme: "dark" | "light") =>
    (await siteIconFor("example.com", theme, d))?.bytes.toString();

  it("is taken over the icons named before it, and over the proxy's", async () => {
    const fetch = proxyAnswering(svgOf("<svg>page</svg>"));
    const d = deps(fetch);

    expect(await rememberPageIcon(page, d)).toBe(true);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.com/a.svg");
    expect(await textFor(d, "dark")).toBe("<svg>page</svg>");
    expect(await rememberPageIcon(page, d)).toBe(false);
  });

  it("is not asked for again unguarded when its address is refused", async () => {
    const fetch = proxyAnswering(none);
    const iconUrls = ["http://192.168.1.1/x.svg", "http://10.0.0.1/y.png"];

    expect(await rememberPageIcon({ ...page, iconUrls }, deps(fetch))).toBe(
      false,
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("stands for a day against its front page naming another, or none", async () => {
    const fetch = proxyAnswering(svgOf("one"), svgOf("two"), none, unreachable);
    const d = deps(fetch);
    const naming = (name: string) =>
      rememberPageIcon(
        { ...page, iconUrls: [`https://example.com/${name}`] },
        d,
      );
    await naming("one.svg");

    expect(await naming("two.svg")).toBe(false);
    await naming("badge.png");
    expect(await textFor(d, "dark")).toBe("one");
    now += 2 * DAY_MS;
    expect(await naming("two.svg")).toBe(true);
    expect(await textFor(d, "dark")).toBe("two");
    now += 2 * DAY_MS;
    await naming("plain.png");
    expect(await textFor(d, "dark")).toBeUndefined();
  });

  it("is the front page's when both pages' are fetched at once", async () => {
    let answer: (response: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const fetch = proxyAnswering(() => slow, svgOf("front"));
    const d = deps(fetch);
    const docs = rememberPageIcon(
      {
        ...page,
        iconUrls: ["https://example.com/docs.svg"],
        pageUrl: "https://example.com/docs",
      },
      d,
    );
    const front = rememberPageIcon(page, d);
    answer(await svgOf("docs")());
    await Promise.all([docs, front]);

    expect(await textFor(d, "dark")).toBe("front");
  });

  it.each([
    ["www.example.com", "example.com"],
    ["example.com", "www.example.com"],
  ])("opened at %s is the icon at %s too", async (opened, other) => {
    const fetch = proxyAnswering(svgOf("page"));
    const d = deps(fetch);
    await rememberPageIcon({ ...page, pageUrl: `https://${opened}/` }, d);

    expect((await siteIconFor(other, "dark", d))?.bytes.toString()).toBe(
      "page",
    );
  });

  it.each([
    ["unreachable", unreachable],
    ["not an SVG", found],
  ])(
    "gives way to the page's first icon when it is %s and the proxy has none",
    async (_name, answer) => {
      const fetch = proxyAnswering(answer, none, found);
      const d = deps(fetch);

      expect(await rememberPageIcon(page, d)).toBe(true);
      expect(fetch.mock.calls[2]?.[0]).toBe("https://example.com/a.ico");
      expect((await siteIconFor("example.com", "dark", d))?.type).toBe(
        "image/png",
      );
    },
  );

  it("is kept apart for each theme, and stands in for the other where it can be seen", async () => {
    const fetch = proxyAnswering(svgOf("white ink"), svgOf("dark ink"));
    const d = deps(fetch);
    await rememberPageIcon(page, d);

    expect(await textFor(d, "light")).toBe("white ink");
    await rememberPageIcon(
      { ...page, iconUrls: ["https://example.com/b.svg"], theme: "light" },
      d,
    );
    expect(await textFor(d, "light")).toBe("dark ink");
    expect(await textFor(d, "dark")).toBe("white ink");
  });

  it("is the front page's once that is opened, whichever page named one first", async () => {
    const fetch = proxyAnswering(svgOf("first"), svgOf("front"));
    const d = deps(fetch);
    const at = (pageUrl: string, name: string) =>
      rememberPageIcon(
        { ...page, iconUrls: [`https://example.com/${name}.svg`], pageUrl },
        d,
      );

    expect(await at("https://example.com/sheets", "sheets")).toBe(true);
    expect(await at("https://example.com/docs", "docs")).toBe(false);
    expect(await at("https://example.com/", "front")).toBe(true);
    expect(await at("https://example.com/docs", "docs")).toBe(false);
    expect(await textFor(d, "dark")).toBe("front");
  });
});
