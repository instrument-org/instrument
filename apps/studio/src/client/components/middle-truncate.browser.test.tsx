import { fitMiddle, fitTwoLines, fontOf } from "@/client/lib/middle-truncate";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { MiddleTruncate, TwoLineTruncate } from "./middle-truncate";

const NAME = "Acme-Corporation-invoice-2026-0412.pdf";

const fontAt = () => {
  const probe = document.createElement("span");
  probe.className = "text-sm";
  document.body.append(probe);
  const font = fontOf(probe);
  probe.remove();
  return font;
};

describe("fitMiddle", () => {
  it("keeps a name that fits", () => {
    expect(fitMiddle(NAME, 10_000, fontAt())).toBe(NAME);
  });

  it("keeps the start, the end and the extension", () => {
    const cut = fitMiddle(NAME, 120, fontAt(), { extension: true });
    expect(cut).toMatch(/^Acme.*….*0412\.pdf$/);
  });

  it("never splits an emoji", () => {
    const cut = fitMiddle("👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦", 60, fontAt());
    expect(cut.replaceAll("👩‍👩‍👧‍👦", "")).toBe("…");
  });

  it("drops the extension's pin when the name has no room for it", () => {
    expect(
      fitMiddle("abcdefghij.markdown", 40, fontAt(), { extension: true }),
    ).not.toMatch(/\.markdown$/);
  });
});

describe("fitTwoLines", () => {
  it("fills the first line and cuts the second in its middle", () => {
    const [first, second] = fitTwoLines(NAME, 110, fontAt(), {
      extension: true,
    });
    expect(NAME.startsWith(first)).toBe(true);
    expect(second).toMatch(/….*\.pdf$/);
  });

  it("gives the first line's start to a mark before the name", () => {
    const [plain] = fitTwoLines(NAME, 110, fontAt(), { extension: true });
    const [marked] = fitTwoLines(NAME, 110, fontAt(), {
      extension: true,
      indent: 30,
    });
    expect(plain.startsWith(marked)).toBe(true);
    expect(marked.length).toBeLessThan(plain.length);
  });
});

describe("MiddleTruncate", () => {
  it.each([80, 140, 400])("fits a %ipx box without clipping", async (width) => {
    const screen = await renderInBrowser(
      <div className="flex text-sm" style={{ width }}>
        <MiddleTruncate extension text={NAME} />
      </div>,
    );
    const box = screen.container.querySelector<HTMLElement>("[data-text]");
    const shown = box?.querySelector<HTMLElement>(
      ":scope > span:not(.sr-only)",
    );
    expect(box && shown).toBeTruthy();
    if (!box || !shown) {
      return;
    }
    expect(shown.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    expect(box.clientWidth).toBeLessThanOrEqual(width);
    if (width < 400) {
      expect(shown.textContent).toContain("…");
    } else {
      expect(shown.textContent).toBe(NAME);
    }
  });

  it("follows its box when it grows again", async () => {
    const screen = await renderInBrowser(
      <div className="flex text-sm" data-testid="row" style={{ width: 80 }}>
        <MiddleTruncate extension text={NAME} />
      </div>,
    );
    const row =
      screen.container.querySelector<HTMLElement>("[data-testid=row]");
    if (!row) {
      throw new Error("no row");
    }
    row.style.width = "600px";
    await expect
      .poll(
        () =>
          row.querySelector("[aria-hidden]")?.textContent ?? row.textContent,
      )
      .toBe(NAME);
  });
});

describe("TwoLineTruncate", () => {
  it("shows two lines in a narrow tile", async () => {
    const screen = await renderInBrowser(
      <div className="text-xs" style={{ width: 90 }}>
        <TwoLineTruncate extension text={NAME} />
      </div>,
    );
    const lines = screen.container.querySelectorAll("[aria-hidden]");
    expect(lines).toHaveLength(2);
    expect(lines[1]?.textContent).toMatch(/….*\.pdf$/);
  });

  it("starts the first line with its lead and keeps the name whole where it fits", async () => {
    const screen = await renderInBrowser(
      <div className="text-xs" style={{ width: 200 }}>
        <TwoLineTruncate lead={<i data-testid="lead" />} text="Contracts" />
      </div>,
    );
    const lead = screen.container.querySelector("[data-testid=lead]");
    expect(lead?.closest("span.block")?.textContent).toBe("Contracts");
    expect(screen.container.querySelectorAll("[aria-hidden]")).toHaveLength(0);
  });
});
