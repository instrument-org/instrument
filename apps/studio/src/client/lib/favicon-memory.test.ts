import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetFaviconSources,
  rememberedFaviconSource,
  rememberFaviconSource,
} from "./favicon-memory";

describe("favicon memory", () => {
  beforeEach(() => {
    forgetFaviconSources();
    vi.useFakeTimers();
    // The memory records nothing offline, and Node's own navigator says
    // nothing either way; the renderer's always does.
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("answers the proxy for a site never asked about", () => {
    expect(rememberedFaviconSource("https://example.com/page")).toBe("proxy");
  });

  it("remembers by host, whatever page was asked about", () => {
    rememberFaviconSource("https://example.com/a", "none");
    expect(rememberedFaviconSource("https://example.com/b?x=1")).toBe("none");
    expect(rememberedFaviconSource("https://other.example/")).toBe("proxy");
  });

  it("forgets an answer once it has expired", () => {
    rememberFaviconSource("https://example.com/", "none");
    vi.advanceTimersByTime(15 * 24 * 60 * 60 * 1000);
    expect(rememberedFaviconSource("https://example.com/")).toBe("proxy");
  });

  it("drops a host once the proxy serves it again", () => {
    rememberFaviconSource("https://example.com/", "none");
    rememberFaviconSource("https://example.com/", "proxy");
    expect(rememberedFaviconSource("https://example.com/")).toBe("proxy");
  });

  it("records nothing while offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    rememberFaviconSource("https://example.com/", "none");
    expect(rememberedFaviconSource("https://example.com/")).toBe("proxy");
  });
});
