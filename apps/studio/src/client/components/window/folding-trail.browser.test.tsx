import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { FoldingTrail } from "./folding-trail";

const TITLE = "Plan the quarterly review of the design system";

// Measured in the app's own font, which a fallback drawn first is narrower than.
const renderTrail = async (cutsAtEnd: boolean) => {
  await document.fonts.ready;
  return renderInBrowser(
    <div className="flex text-sm" style={{ width: 160 }}>
      <FoldingTrail
        cutsAtEnd={() => cutsAtEnd}
        labels={[TITLE]}
        mark={() => null}
        part={(_, content) => <span className="flex">{content}</span>}
        separator={<span>›</span>}
      />
    </div>,
  );
};

const shownName = async (cutsAtEnd: boolean) => {
  const screen = await renderTrail(cutsAtEnd);
  await expect
    .poll(() => screen.container.querySelector(".sr-only, .text-ellipsis"))
    .not.toBeNull();
  const name = [
    ...screen.container.querySelectorAll<HTMLElement>(".whitespace-pre"),
  ][0];
  return name;
};

describe("FoldingTrail", () => {
  it("cuts a title at its end", async () => {
    const name = await shownName(true);
    expect(name?.textContent).toBe(TITLE);
    expect(name?.classList.contains("text-ellipsis")).toBe(true);
    expect(name && name.scrollWidth > name.clientWidth).toBe(true);
  });

  it("cuts any other name in its middle", async () => {
    const name = await shownName(false);
    expect(name?.textContent).toMatch(/^Plan.*….*system$/);
  });

  it("cuts the last name further while a folded folder shows its whole name, so the trail's end stays in its box", async () => {
    const labels = [
      "Workspace",
      "Projects",
      "Regional office renovation",
      "Phase two drawings and quotes for the client",
    ];
    await document.fonts.ready;
    // Narrow enough that the last name is cut in any font.
    const screen = await renderInBrowser(
      <div className="flex text-sm" style={{ width: 240 }}>
        <FoldingTrail
          labels={labels}
          mark={(index) => (
            <span className="block size-3 shrink-0" data-mark={index} />
          )}
          part={(_, content) => <span className="flex">{content}</span>}
          separator={<span className="px-1">›</span>}
        />
      </div>,
    );
    const trail = screen.container.firstElementChild?.firstElementChild;
    const lastName = () =>
      trail?.querySelectorAll(".whitespace-pre:not([data-crumb-name])")[3]
        ?.textContent;
    await expect.poll(lastName).toMatch(/^Phase .*…/);
    const folded = trail?.querySelector('[data-mark="1"]');
    if (!trail || !folded) {
      throw new Error("no trail rendered");
    }

    await userEvent.hover(folded);

    await expect
      .poll(() => trail.querySelectorAll(".whitespace-pre")[1]?.textContent)
      .toBe("Projects");
    await expect
      .poll(() => trail.scrollWidth - trail.clientWidth)
      .toBeLessThanOrEqual(1);
    expect(lastName()).toMatch(/^Phase .*…/);
  });
});
