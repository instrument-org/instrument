import { renderInBrowser } from "@/tests/render-browser";
import { createPortal } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { currentDrag } from "./drag/session";
import { TabLocationRow } from "./tab-location-row";

/** Whether the field's words come with a menu up. */
const menu = vi.hoisted(() => ({ isUp: false }));

// The field's words, which need the app window around them; what is under
// test is the box they sit in. A menu item stands in for the menu a part of
// the place opens: inside the field in React's tree, drawn outside its box.
vi.mock("./omnibar", () => ({
  Omnibar: ({ initial }: { initial: string }) => (
    <>
      <input aria-label="Address" defaultValue={initial} />
      {menu.isUp &&
        createPortal(<div role="menuitem">Copy Path</div>, document.body)}
    </>
  ),
}));

afterEach(() => {
  document.body.replaceChildren();
});

/** A place outside the row that takes whatever is dropped on it, and says what it carried. */
function dropZone() {
  const zone = document.createElement("div");
  zone.textContent = "Drop zone";
  Object.assign(zone.style, {
    height: "200px",
    left: "0",
    position: "fixed",
    top: "200px",
    width: "400px",
  });
  const dropped: { types: string[]; uri: string }[] = [];
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropped.push({
      types: [...(event.dataTransfer?.types ?? [])],
      uri: event.dataTransfer?.getData("text/uri-list") ?? "",
    });
  });
  document.body.append(zone);
  return { dropped, zone };
}

it("carries a site's address out of the field by the system's drag, never the pointer's", async () => {
  const screen = await renderInBrowser(
    <TabLocationRow
      address="https://example.com/a"
      location={{ kind: "page", url: "https://example.com/a" }}
      title="Example"
    />,
  );
  const { dropped, zone } = dropZone();
  const field = screen.container.querySelector(
    "[data-tab-location] .group\\/field",
  );
  if (!(field instanceof HTMLElement)) {
    throw new Error("no field");
  }
  expect(field.getAttribute("draggable")).toBe("true");

  await userEvent.dragAndDrop(field, zone);

  expect(dropped).toEqual([
    {
      types: expect.arrayContaining(["text/uri-list", "text/plain"]),
      uri: "https://example.com/a",
    },
  ]);
  expect(currentDrag()).toBeUndefined();
});

it("leaves a press on a menu opened from the field to the menu", async () => {
  menu.isUp = true;
  const screen = await renderInBrowser(
    <TabLocationRow
      address="https://example.com/a"
      location={{ kind: "page", url: "https://example.com/a" }}
      title="Example"
    />,
  );
  try {
    await userEvent.click(page.getByRole("menuitem", { name: "Copy Path" }));

    expect(document.activeElement).toBe(document.body);
  } finally {
    menu.isUp = false;
    await screen.unmount();
  }
});
