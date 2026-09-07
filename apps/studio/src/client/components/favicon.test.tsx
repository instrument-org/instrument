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

  // The proxy answers a site it has no icon for with a 16px globe of its own,
  // under a 404 an <img> draws anyway; asked for 64, so small an answer is the
  // stand-in, and the site itself is asked next.
  it("takes a tiny proxy answer as no icon and asks the site for its own", () => {
    const image = renderFavicon("https://no-icon.example.com/page");
    expect(image.src).toContain("gstatic.com");

    Object.defineProperty(image, "naturalWidth", { value: 16 });
    fireEvent.load(image);

    expect(image.src).toBe("https://no-icon.example.com/favicon.ico");
  });

  it("draws a globe of its own once the site has no icon either", () => {
    const image = renderFavicon("https://no-icon-anywhere.example.com/page");
    fireEvent.error(image);
    fireEvent.error(image);

    const globe = screen.getByRole("img", {
      name: "Favicon for no-icon-anywhere.example.com",
    });
    expect(globe.tagName).toBe("svg");
  });
});
