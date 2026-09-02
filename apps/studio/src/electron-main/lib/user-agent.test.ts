import { describe, expect, it } from "vitest";

import {
  isPotentiallyTrustworthy,
  normalizeUserAgent,
  platformHint,
  secChUaBrands,
  secChUaHeader,
  standardUserAgentHeaders,
  userAgentMetadata,
  weightedAcceptLanguage,
  withBaseLanguages,
} from "./user-agent";

const ELECTRON_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Studio/1.3.1 Chrome/128.0.0.0 Electron/32.0.1 " +
  "Safari/537.36";

// The normalized UA this Electron produces, full version left intact.
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.7778.218 Safari/537.36";

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

  // Ground truth, and the reason the permutation is reproduced rather than
  // guessed: a real Google Chrome 152 on macOS reports exactly this list and
  // order. Getting the order wrong is not cosmetic -- it is the page and the
  // header describing two different browsers again.
  it("matches a real Chrome build's own three-brand list and order", () => {
    expect(secChUaBrands(152, { chromeBranded: true })).toMatchInlineSnapshot(`
      [
        {
          "brand": "Chromium",
          "version": "152",
        },
        {
          "brand": "Not?A_Brand",
          "version": "24",
        },
        {
          "brand": "Google Chrome",
          "version": "152",
        },
      ]
    `);
  });

  it("scatters the three-brand list differently for another major", () => {
    expect(secChUaBrands(148, { chromeBranded: true })).toMatchInlineSnapshot(`
      [
        {
          "brand": "Chromium",
          "version": "148",
        },
        {
          "brand": "Google Chrome",
          "version": "148",
        },
        {
          "brand": "Not/A)Brand",
          "version": "99",
        },
      ]
    `);
  });

  it("keeps the same GREASE entry whether or not the build is branded", () => {
    const unbranded = secChUaBrands(148).find(({ brand }) =>
      brand.startsWith("Not"),
    );
    const branded = secChUaBrands(148, { chromeBranded: true }).find(
      ({ brand }) => brand.startsWith("Not"),
    );
    expect(branded).toEqual(unbranded);
  });
});

describe("userAgentMetadata", () => {
  // Every field is pinned because an omitted one comes back empty from
  // getHighEntropyValues rather than falling back to what Blink would say, and
  // an empty high-entropy answer is its own inconsistency.
  it("reproduces what Blink derives, with the branded list", () => {
    expect(
      userAgentMetadata({
        arch: "arm64",
        platform: "darwin",
        systemVersion: "26.6.2",
        userAgent: CHROME_UA,
      }),
    ).toMatchInlineSnapshot(`
      {
        "architecture": "arm",
        "bitness": "64",
        "brands": [
          {
            "brand": "Chromium",
            "version": "148",
          },
          {
            "brand": "Google Chrome",
            "version": "148",
          },
          {
            "brand": "Not/A)Brand",
            "version": "99",
          },
        ],
        "fullVersion": "148.0.7778.218",
        "fullVersionList": [
          {
            "brand": "Chromium",
            "version": "148.0.7778.218",
          },
          {
            "brand": "Google Chrome",
            "version": "148.0.7778.218",
          },
          {
            "brand": "Not/A)Brand",
            "version": "99.0.0.0",
          },
        ],
        "mobile": false,
        "model": "",
        "platform": "macOS",
        "platformVersion": "26.6.2",
        "wow64": false,
      }
    `);
  });

  it("maps an Intel host to the architecture Chrome reports there", () => {
    expect(
      userAgentMetadata({
        arch: "x64",
        platform: "win32",
        systemVersion: "10.0.22631",
        userAgent: CHROME_UA,
      }),
    ).toMatchObject({
      architecture: "x86",
      bitness: "64",
      platform: "Windows",
      platformVersion: "10.0.22631",
    });
  });

  it("returns null when the UA carries no version to derive from", () => {
    expect(
      userAgentMetadata({
        arch: "arm64",
        platform: "darwin",
        systemVersion: "26.6.2",
        userAgent: "Mozilla/5.0 Safari/537.36",
      }),
    ).toBeNull();
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

describe("isPotentiallyTrustworthy", () => {
  it.each([
    ["https://example.com/", true],
    ["wss://example.com/socket", true],
    ["http://localhost:5173/", true],
    ["http://app.localhost:3000/", true],
    ["http://127.0.0.1:8080/", true],
    ["http://127.5.5.5/", true],
    ["http://[::1]:9222/json", true],
    ["http://example.com/", false],
    ["http://10.0.0.4/", false],
    ["not a url", false],
  ])("%s -> %s", (url, expected) => {
    expect(isPotentiallyTrustworthy(url)).toBe(expected);
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

  // A real Chrome on a machine set to en-US sends exactly this, and reports
  // ["en-US", "en"] from navigator.languages as a result. A lone region tag is
  // the shape no ordinary install produces.
  it("follows a lone region tag with its base, the way Chrome does", () => {
    expect(weightedAcceptLanguage(["en-US"])).toMatchInlineSnapshot(
      `"en-US,en;q=0.9"`,
    );
  });

  it("expands every region tag in a longer preference list", () => {
    expect(weightedAcceptLanguage(["en-GB", "fr-FR"])).toMatchInlineSnapshot(
      `"en-GB,en;q=0.9,fr-FR;q=0.8,fr;q=0.7"`,
    );
  });
});

describe("withBaseLanguages", () => {
  it("leaves a list that already names its bases untouched", () => {
    expect(withBaseLanguages(["en-US", "en", "fr"])).toEqual([
      "en-US",
      "en",
      "fr",
    ]);
  });

  it("keeps the caller's own position for a base named later", () => {
    expect(withBaseLanguages(["fr-CA", "en", "fr"])).toEqual([
      "fr-CA",
      "fr",
      "en",
    ]);
  });

  it("adds nothing for tags that carry no region", () => {
    expect(withBaseLanguages(["en", "fr"])).toEqual(["en", "fr"]);
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
      url: "https://example.com/",
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
      url: "https://example.com/",
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
      url: "https://example.com/",
      userAgent: "Mozilla/5.0 Safari/537.36",
    });
    expect(result["sec-ch-ua"]).toBeUndefined();
    expect(result["sec-ch-ua-platform"]).toBe('"Windows"');
  });

  it("sends no client hints to an origin Chromium would not hint", () => {
    const result = standardUserAgentHeaders({
      acceptLanguage: "en-US",
      platform: "darwin",
      requestHeaders: { Accept: "text/html" },
      url: "http://example.com/",
      userAgent: ELECTRON_UA,
    });
    expect(Object.keys(result)).toMatchInlineSnapshot(`
      [
        "Accept",
        "User-Agent",
        "Accept-Language",
      ]
    `);
    expect(result["User-Agent"]).not.toContain("Electron/");
  });
});
