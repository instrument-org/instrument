import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {} }));
vi.mock("./electron-logger", () => ({ logger: { warn: vi.fn() } }));

const { spellCheckerLanguagesFor } = await import("./spellcheck-languages");

const available = ["en-US", "en-GB", "de-DE", "fr", "pt-BR", "pt-PT"];

describe("spellCheckerLanguagesFor", () => {
  it.each([
    { preferred: ["en-US"], expected: ["en-US"] },
    { preferred: ["en-US", "de-DE"], expected: ["en-US", "de-DE"] },
    { preferred: ["de-AT", "en-AU"], expected: ["de-DE", "en-US"] },
    { preferred: ["fr-CA"], expected: ["fr"] },
    { preferred: ["pt_PT"], expected: ["pt-PT"] },
    { preferred: ["EN-gb"], expected: ["en-GB"] },
    { preferred: ["en-US", "en-NZ"], expected: ["en-US"] },
    { preferred: ["ja-JP"], expected: [] },
  ])("$preferred -> $expected", ({ preferred, expected }) => {
    expect(spellCheckerLanguagesFor(preferred, available)).toEqual(expected);
  });
});
