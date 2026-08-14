import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { ImageWithFallback } from "./image-with-fallback";

describe("ImageWithFallback", () => {
  it("fades a surface in on load, without the scale an icon gets", () => {
    renderWithProviders(
      <ImageWithFallback
        alt="A chart"
        filename="chart.png"
        src="/assets/fades-in.png"
      />,
    );

    const image = screen.getByRole("img");
    expect(image.className).toContain("opacity-0");
    expect(image.className).not.toContain("scale-75");

    fireEvent.load(image);

    expect(image.className).not.toContain("opacity-0");
  });

  // The image viewer holds its zoom controls back until this fires, so an
  // arrival that swallowed it would leave a loaded image with no controls.
  it("still calls a caller's own load handler", () => {
    const onLoad = vi.fn();
    renderWithProviders(
      <ImageWithFallback
        alt="A chart"
        filename="chart.png"
        onLoad={onLoad}
        src="/assets/reports-loading.png"
      />,
    );

    fireEvent.load(screen.getByRole("img"));

    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
