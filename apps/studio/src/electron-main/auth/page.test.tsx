import { describe, expect, it } from "vitest";

import { renderAuthPage } from "./page";

// A jsdom test for the page's own scripts, which only run in a document.
describe("renderAuthPage", () => {
  it("takes the callback's token out of the address it landed on", async () => {
    const page = await renderAuthPage({
      email: "person@example.com",
      kind: "signed-in",
      service: { name: "Google" },
    });
    history.replaceState(null, "", "/auth/callback/instrument?state=s&token=t");
    const parsed = new DOMParser().parseFromString(String(page), "text/html");
    // An inline script appended to the live document runs as the browser
    // would run it.
    for (const script of parsed.head.querySelectorAll("script:not([src])")) {
      const live = document.createElement("script");
      live.textContent = script.textContent;
      document.head.append(live);
    }
    expect(location.pathname + location.search).toBe(
      "/auth/callback/instrument",
    );
  });
});
