import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  classifyImageSource,
  isImageSourceAllowed,
  MARKDOWN_IMAGE_KINDS,
  REMOTE_HOST_SUFFIXES,
  REMOTE_HOSTS,
  UNTRUSTED_FILE_IMAGE_KINDS,
} from "./image-policy";

describe("classifyImageSource", () => {
  it.each([
    ["data:image/png;base64,QUJD", "embedded"],
    ["DATA:IMAGE/PNG;base64,QUJD", "embedded"],
    ["  data:image/svg+xml;base64,QUJD  ", "embedded"],
    ["/output/plot.png", "task-relative"],
    ["./output/plot.png", "task-relative"],
    ["../output/plot.png", "task-relative"],
    ["http://assets.task-1.localhost:4321/output/plot.png", "task-asset"],
    ["https://github.com/o/r/p.png", "remote"],
    ["https://raw.githubusercontent.com/o/r/main/p.png", "remote"],
    ["https://images.google.com/p.png", "remote"],
  ] as const)("reads %s as %s", (src, kind) => {
    expect(classifyImageSource(src)).toBe(kind);
  });

  it.each([
    // A bare word resolves against nothing, so it is not a path on sight.
    ["output/plot.png"],
    // Protocol-relative: the one source that could name any host at all, and it
    // has to be caught before the leading slash reads as a path.
    ["//tracker.test/pixel.png"],
    // A host the allow-list does not know.
    ["https://tracker.test/pixel.png"],
    // The allowed host as a path rather than a host.
    ["https://evil.test/x.githubusercontent.com/p.png"],
    // The allowed host in a query, which opens before the first slash does.
    ["https://evil.test?a=.githubusercontent.com/p.png"],
    // The allowed host as a prefix of the real one.
    ["https://x.githubusercontent.com.evil.test/p.png"],
    // The asset origin is local, so it is the one host reachable without TLS.
    // Any other host over plain http is not.
    ["http://tracker.test/pixel.png"],
    // Bytes that are not a picture.
    ["data:text/html;base64,PGI+aGk8L2I+"],
    [""],
    [undefined],
  ])("rejects %s", (src) => {
    expect(classifyImageSource(src)).toBe("rejected");
  });
});

describe("isImageSourceAllowed", () => {
  // Markdown written for this reader points wherever the classifier knows a
  // source to be, since every kind it names is one such a document may mean.
  it("gives markdown every kind it can read", () => {
    for (const src of [
      "data:image/png;base64,QUJD",
      "./output/plot.png",
      "http://assets.task-1.localhost:4321/p.png",
      "https://raw.githubusercontent.com/o/r/main/p.png",
    ]) {
      expect(isImageSourceAllowed(src, MARKDOWN_IMAGE_KINDS)).toBe(true);
    }
  });

  // A notebook is a file someone else wrote. Its own pictures are embedded, so
  // the narrowest answer costs it nothing.
  it("gives an untrusted file embedded bytes and nothing else", () => {
    expect(
      isImageSourceAllowed(
        "data:image/png;base64,QUJD",
        UNTRUSTED_FILE_IMAGE_KINDS,
      ),
    ).toBe(true);

    for (const src of [
      "./output/plot.png",
      "http://assets.task-1.localhost:4321/p.png",
      "https://raw.githubusercontent.com/o/r/main/p.png",
    ]) {
      expect(isImageSourceAllowed(src, UNTRUSTED_FILE_IMAGE_KINDS)).toBe(false);
    }
  });

  // Listing every kind must not be a way to say yes to anything.
  it("never admits a rejected source", () => {
    expect(
      isImageSourceAllowed("https://tracker.test/pixel.png", [
        "embedded",
        "rejected",
        "remote",
        "task-asset",
        "task-relative",
      ]),
    ).toBe(false);
  });
});

// A surface that admits the `remote` kind draws these images inline, so the
// window's `img-src` must actually fetch from every host this module calls
// remote, or an allowed image draws broken. The CSP staying wider than this
// list is fine and deliberate; this only fails when the policy names a host
// the CSP refuses.
describe("the remote allowlist inside the CSP", () => {
  const html = readFileSync(
    fileURLToPath(new URL("../../index.html", import.meta.url)),
    "utf8",
  );
  const imgSrc = /img-src ([^;]+);/.exec(html)?.[1];
  const sources = imgSrc?.split(/\s+/).filter(Boolean) ?? [];

  // CSP host-source matching, for the shapes this file uses: an exact
  // `https://host` and a wildcard `https://*.suffix`.
  const cspAllows = (host: string) =>
    sources.some((source) => {
      if (source === `https://${host}`) {
        return true;
      }
      const wildcard = /^https:\/\/\*(\..+)$/.exec(source)?.[1];
      return wildcard !== undefined && host.endsWith(wildcard) && host !== wildcard.slice(1);
    });

  it("found the directive", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each([...REMOTE_HOSTS])("fetches from %s", (host) => {
    expect(cspAllows(host)).toBe(true);
  });

  it.each(REMOTE_HOST_SUFFIXES)("fetches from a host under %s", (suffix) => {
    expect(cspAllows(`probe${suffix}`)).toBe(true);
  });
});
