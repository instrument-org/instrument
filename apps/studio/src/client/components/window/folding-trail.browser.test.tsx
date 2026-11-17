import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { FoldingTrail } from "./folding-trail";

const TITLE = "Plan the quarterly review of the design system";

const renderTrail = (cutsAtEnd: boolean) =>
  renderInBrowser(
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
});
