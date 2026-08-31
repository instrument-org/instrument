import { describe, expect, it } from "vitest";

import {
  normalizeUserAgent,
  platformHint,
  secChUaBrands,
  secChUaHeader,
  standardUserAgentHeaders,
  weightedAcceptLanguage,
} from "./user-agent";

const ELECTRON_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Studio/1.3.1 Chrome/128.0.0.0 Electron/32.0.1 " +
  "Safari/537.36";

describe("normalizeUserAgent", () => {
  it("removes the app-name and Electron tokens, keeping the rest truthful", () => {
    expect(normalizeUserAgent(ELECTRON_UA)).toMatchInlineSnapshot(
      `"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"`,
    );
  });

  it("removes a dev-suffixed app token that would not match app.getName()", () => {
    const dev =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Instrument(Dev)/1.3.1-beta.0 Chrome/148.0.7778.218 " +
      "Electron/40.0.0 Safari/537.36";
    expect(normalizeUserAgent(dev)).toMatchInlineSnapshot(
      `"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.218 Safari/537.36"`,
    );
  });

  it("is idempotent on an already-standard Chrome UA", () => {
    const clean =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
    expect(normalizeUserAgent(clean)).toBe(clean);
    expect(normalizeUserAgent(normalizeUserAgent(ELECTRON_UA))).toBe(
      normalizeUserAgent(ELECTRON_UA),
    );
  });
});

describe("secChUaBrands", () => {
  // Pinned against what a real Electron reports in navigator.userAgentData:
  // Electron 42.3.3 (Chromium 148) serves exactly this list. The e2e test
  // re-checks the live browser; these cases keep the generation honest without
  // booting one.
  it("generates the engine's own brand list for a major version", () => {
    expect(secChUaBrands(148)).toMatchInlineSnapshot(`
      [
        {
          "brand": "Not/A)Brand",
          "version": "99",
        },
        {
          "brand": "Chromium",
          "version": "148",
        },
      ]
    `);
  });

  it("puts the Chromium brand first for an odd major version", () => {
    expect(secChUaBrands(147)).toMatchInlineSnapshot(`
      [
        {
          "brand": "Chromium",
          "version": "147",
        },
        {
          "brand": "Not.A/Brand",
          "version": "8",
        },
      ]
    `);
  });

  // Majors whose published Chrome sec-ch-ua headers are known, so the cycle is
  // checked against three releases rather than only the one installed here.
  it("cycles the GREASE punctuation and version with the major", () => {
    expect(
      [120, 128, 131].map((major) =>
        secChUaBrands(major).find(({ brand }) => brand !== "Chromium"),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "brand": "Not_A Brand",
          "version": "8",
        },
        {
          "brand": "Not;A=Brand",
          "version": "24",
        },
        {
          "brand": "Not_A Brand",
          "version": "24",
        },
      ]
    `);
  });
});

describe("secChUaHeader", () => {
  it("serializes the brand list from the Chrome major version", () => {
    expect(secChUaHeader(ELECTRON_UA)).toMatchInlineSnapshot(
      `""Not;A=Brand";v="24", "Chromium";v="128""`,
    );
  });

  it("names no brand the page's navigator.userAgentData cannot report", () => {
    expect(secChUaHeader(ELECTRON_UA)).not.toContain("Google Chrome");
  });

  it("returns null when no Chrome/Chromium version is present", () => {
    expect(secChUaHeader("Mozilla/5.0 Safari/537.36")).toBeNull();
  });
});

describe("platformHint", () => {
  it.each([
    ["darwin", '"macOS"'],
    ["win32", '"Windows"'],
    ["linux", '"Linux"'],
    ["freebsd", '"Linux"'],
  ] satisfies [NodeJS.Platform, string][])(
    "maps %s to %s",
    (platform, expected) => {
      expect(platformHint(platform)).toBe(expected);
    },
  );
});

describe("weightedAcceptLanguage", () => {
  it("keeps the first language at q=1 and steps down 0.1 per entry", () => {
    expect(weightedAcceptLanguage(["en-US", "en", "fr"])).toMatchInlineSnapshot(
      `"en-US,en;q=0.9,fr;q=0.8"`,
    );
  });

  it("floors the quality weight at 0.1 for long lists", () => {
    const langs = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    expect(weightedAcceptLanguage(langs)).toMatchInlineSnapshot(
      `"a,b;q=0.9,c;q=0.8,d;q=0.7,e;q=0.6,f;q=0.5,g;q=0.4,h;q=0.3,i;q=0.2,j;q=0.1,k;q=0.1,l;q=0.1"`,
    );
  });
});

describe("standardUserAgentHeaders", () => {
  it("rewrites UA and injects consistent client hints", () => {
    const result = standardUserAgentHeaders({
      acceptLanguage: "en-US,en;q=0.9",
      platform: "darwin",
      requestHeaders: {
        Accept: "text/html",
        "User-Agent": ELECTRON_UA,
      },
      userAgent: ELECTRON_UA,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "sec-ch-ua": ""Not;A=Brand";v="24", "Chromium";v="128"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": ""macOS"",
      }
    `);
  });

  it("replaces a differently-cased existing header rather than duplicating it", () => {
    const result = standardUserAgentHeaders({
      acceptLanguage: "en-US",
      platform: "linux",
      requestHeaders: { "accept-language": "de", "user-agent": ELECTRON_UA },
      userAgent: ELECTRON_UA,
    });
    expect(Object.keys(result)).toMatchInlineSnapshot(`
      [
        "User-Agent",
        "Accept-Language",
        "sec-ch-ua",
        "sec-ch-ua-mobile",
        "sec-ch-ua-platform",
      ]
    `);
    expect(result["Accept-Language"]).toBe("en-US");
  });

  it("omits sec-ch-ua when the UA has no Chrome version", () => {
    const result = standardUserAgentHeaders({
      acceptLanguage: "en-US",
      platform: "win32",
      requestHeaders: {},
      userAgent: "Mozilla/5.0 Safari/537.36",
    });
    expect(result["sec-ch-ua"]).toBeUndefined();
    expect(result["sec-ch-ua-platform"]).toBe('"Windows"');
  });
});
