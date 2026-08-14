import { TooltipProvider } from "@radix-ui/react-tooltip";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { Favicon } from "./favicon";

function renderFavicon(url: string) {
  renderWithProviders(
    <TooltipProvider>
      <Favicon url={url} />
    </TooltipProvider>,
  );
  return screen.getAllByRole("img").at(-1) as HTMLImageElement;
}

describe("Favicon", () => {
  it("holds an icon back until it loads, then fades it in", () => {
    const image = renderFavicon("https://fades-in.example.com/page");

    expect(image.className).toContain("opacity-0");
    expect(image.className).toContain("transition-[opacity,scale]");

    fireEvent.load(image);

    expect(image.className).not.toContain("opacity-0");
    expect(image.className).toContain("transition-[opacity,scale]");
  });

  it("draws an icon that already loaded once with no animation at all", () => {
    const url = "https://already-loaded.example.com/page";
    fireEvent.load(renderFavicon(url));

    const remounted = renderFavicon(url);

    expect(remounted.className).not.toContain("opacity-0");
    expect(remounted.className).not.toContain("transition-");
  });
});
