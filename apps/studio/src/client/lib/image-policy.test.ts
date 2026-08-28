import { describe, expect, it } from "vitest";

import {
  classifyImageSource,
  isImageSourceAllowed,
  MARKDOWN_IMAGE_KINDS,
  MARKDOWN_IMAGE_KINDS_WITH_REMOTE,
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
  // The difference the flag makes, and the only one.
  it("takes a remote host only where the surface asked for it", () => {
    const src = "https://raw.githubusercontent.com/o/r/main/p.png";

    expect(isImageSourceAllowed(src, MARKDOWN_IMAGE_KINDS_WITH_REMOTE)).toBe(
      true,
    );
    expect(isImageSourceAllowed(src, MARKDOWN_IMAGE_KINDS)).toBe(false);
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
