import { renderInBrowser } from "@/tests/render-browser";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { EDGE_FADE, useEdgeFade } from "./use-edge-fade";

function Row({
  lifted,
  scrolls,
  tabWidth,
  transform,
}: {
  lifted?: string;
  scrolls: boolean;
  tabWidth: number;
  transform?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeFade(ref, { lifted, scrolls });
  return (
    <div
      className={EDGE_FADE}
      data-testid="row"
      ref={ref}
      style={{ display: "flex", overflowX: "auto", width: 200 }}
    >
      <div
        data-lifted
        style={{ flexShrink: 0, height: 32, transform, width: tabWidth }}
      />
    </div>
  );
}

const fadeOf = (element: HTMLElement | SVGElement) => ({
  end: element.style.getPropertyValue("--edge-fade-end"),
  isFading: element.hasAttribute("data-edge-fade"),
  mask: getComputedStyle(element).maskImage !== "none",
  start: element.style.getPropertyValue("--edge-fade-start"),
});

describe("useEdgeFade", () => {
  it("draws no mask on a row with nothing past its ends", async () => {
    const { getByTestId } = await renderInBrowser(
      <Row scrolls tabWidth={100} />,
    );

    await expect
      .poll(() => fadeOf(getByTestId("row").element()))
      .toMatchObject({
        isFading: false,
        mask: false,
      });
  });

  it("fades the end a row can scroll past, and not the other", async () => {
    const { getByTestId } = await renderInBrowser(
      <Row scrolls tabWidth={500} />,
    );

    await expect
      .poll(() => fadeOf(getByTestId("row").element()))
      .toEqual({
        end: "300px",
        isFading: true,
        mask: true,
        start: "0px",
      });
  });

  it("fades the end a lifted tab is past, by how far it is past", async () => {
    const { getByTestId } = await renderInBrowser(
      <Row
        lifted="[data-lifted]"
        scrolls={false}
        tabWidth={100}
        transform="translateX(-10px)"
      />,
    );

    await expect
      .poll(() => fadeOf(getByTestId("row").element()))
      .toEqual({
        end: "0px",
        isFading: true,
        mask: true,
        start: "10px",
      });
  });
});
