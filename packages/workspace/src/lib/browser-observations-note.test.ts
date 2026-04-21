import { describe, expect, it } from "vitest";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { browserObservationsNote } from "./browser-observations-note";

function shot(
  url: string,
  screenshotPath: string,
): SessionMessagePart.ToolPartContextItem {
  return {
    command: `agent-browser navigate ${url}`,
    createdAt: new Date(0),
    kind: "agent-browser-screenshot",
    screenshotPath,
    url,
  };
}

describe("browserObservationsNote", () => {
  it("returns undefined for empty / missing input", () => {
    expect(browserObservationsNote(undefined)).toBeUndefined();
    expect(browserObservationsNote([])).toBeUndefined();
  });

  it("groups consecutive same-URL screenshots under one URL header", () => {
    expect(
      browserObservationsNote([
        shot("https://a.example", "tool-results/a1.png"),
        shot("https://a.example", "tool-results/a2.png"),
        shot("https://b.example", "tool-results/b1.png"),
      ]),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Auto-captured browser screenshots (shown to the user to reconstruct the session; you may also read these image files if useful). Grouped by URL:
      - https://a.example
        - tool-results/a1.png
        - tool-results/a2.png
      - https://b.example
        - tool-results/b1.png
      </instrument-system-note>"
    `);
  });

  it("repeats a URL header when the user navigated away and back", () => {
    expect(
      browserObservationsNote([
        shot("https://a.example", "tool-results/a1.png"),
        shot("https://b.example", "tool-results/b1.png"),
        shot("https://a.example", "tool-results/a2.png"),
      ]),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Auto-captured browser screenshots (shown to the user to reconstruct the session; you may also read these image files if useful). Grouped by URL:
      - https://a.example
        - tool-results/a1.png
      - https://b.example
        - tool-results/b1.png
      - https://a.example
        - tool-results/a2.png
      </instrument-system-note>"
    `);
  });

  it("caps the list at the most recent observations and notes the omission", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      shot(`https://example.com/${i}`, `tool-results/shot-${i}.png`),
    );
    expect(browserObservationsNote(items)).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Auto-captured browser screenshots (shown to the user to reconstruct the session; you may also read these image files if useful). Grouped by URL:
      - ... 4 earlier screenshot(s) omitted
      - https://example.com/4
        - tool-results/shot-4.png
      - https://example.com/5
        - tool-results/shot-5.png
      - https://example.com/6
        - tool-results/shot-6.png
      - https://example.com/7
        - tool-results/shot-7.png
      - https://example.com/8
        - tool-results/shot-8.png
      - https://example.com/9
        - tool-results/shot-9.png
      - https://example.com/10
        - tool-results/shot-10.png
      - https://example.com/11
        - tool-results/shot-11.png
      - https://example.com/12
        - tool-results/shot-12.png
      - https://example.com/13
        - tool-results/shot-13.png
      - https://example.com/14
        - tool-results/shot-14.png
      - https://example.com/15
        - tool-results/shot-15.png
      - https://example.com/16
        - tool-results/shot-16.png
      - https://example.com/17
        - tool-results/shot-17.png
      - https://example.com/18
        - tool-results/shot-18.png
      - https://example.com/19
        - tool-results/shot-19.png
      </instrument-system-note>"
    `);
  });
});
