import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { PackedFolder } from "./folder-illustration";
import { SetupPage } from "./kit/setup-page";
import { SetupPageSwitch } from "./kit/setup-page-switch";
import { WelcomeBurst } from "./welcome-burst";

/** Welcome and the folder page, as the folder step switches them. */
function WelcomeAndFolder() {
  const [page, setPage] = useState("welcome");
  return (
    <div className="flex h-180 w-270 flex-col">
      <button
        onClick={() => {
          setPage(page === "welcome" ? "folder" : "welcome");
        }}
      >
        Switch
      </button>
      <SetupPageSwitch
        depth={page === "welcome" ? 0 : 1}
        page={page}
        sharedHero={["welcome", "folder"]}
      >
        {page === "welcome" ? (
          <SetupPage hero={<WelcomeBurst />} title="Welcome" />
        ) : (
          <SetupPage hero={<PackedFolder />} title="Folder" />
        )}
      </SetupPageSwitch>
    </div>
  );
}

/** The first frame of a piece's flight, from the picture before. */
function flightOf(name: string) {
  const piece = [
    ...document.querySelectorAll<HTMLElement>(`[data-hero-piece="${name}"]`),
  ].find(
    (element) =>
      element.style.visibility !== "hidden" &&
      element.getAnimations().length > 0,
  );
  const effect = piece?.getAnimations()[0]?.effect;
  return effect instanceof KeyframeEffect
    ? effect.getKeyframes()[0]
    : undefined;
}

describe("Welcome and the folder page's picture", () => {
  it("flies each page from its tilt on Welcome to its tilt in the folder, and back", async () => {
    const screen = await renderInBrowser(<WelcomeAndFolder />);
    await screen.getByRole("button", { name: "Switch" }).click();
    await expect.element(screen.getByText("Folder")).toBeVisible();
    // Welcome's photo leans 7°, the packed folder's -60°.
    expect(flightOf("photo")?.transform).toContain("rotate(67deg)");
    expect(flightOf("pdf")?.transform).toContain("rotate(-68deg)");
    // The folder grows out of the app icon, which hides as it does.
    expect(flightOf("vessel")?.transform).toMatch(/scale\(0\.\d+\)/);

    await screen.getByRole("button", { name: "Switch" }).click();
    await expect.element(screen.getByText("Welcome")).toBeVisible();
    expect(flightOf("photo")?.transform).toContain("rotate(-67deg)");
  });
});
