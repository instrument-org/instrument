import { describe, expect, it } from "vitest";

import { setAttributionHeaders } from "./set-attribution-headers";

describe("setAttributionHeaders", () => {
  it("sets OpenRouter app attribution", () => {
    const headers = new Headers();

    setAttributionHeaders(headers, "openrouter");

    expect(Object.fromEntries(headers)).toMatchInlineSnapshot(`
      {
        "http-referer": "https://tryinstrument.com",
        "x-openrouter-categories": "personal-agent,general-chat",
        "x-openrouter-title": "Instrument",
        "x-title": "Instrument",
      }
    `);
  });

  it("does not send OpenRouter-specific headers to other providers", () => {
    const headers = new Headers();

    setAttributionHeaders(headers, "anthropic");

    expect(Object.fromEntries(headers)).toMatchInlineSnapshot(`
      {
        "http-referer": "https://tryinstrument.com",
        "x-title": "Instrument",
      }
    `);
  });
});
