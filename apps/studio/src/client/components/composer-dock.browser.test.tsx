import { renderInBrowser } from "@/tests/render-browser";
import { expect, it } from "vitest";

import { ComposerDock } from "./composer-dock";

type Card = { id: string };

/**
 * A chat's composer column with a dock over its reply box, outside the tab
 * on show, as a chat popped out of its tab is, with the tab's own reply box
 * beside it.
 */
function Column({ cards }: { cards: Card[] }) {
  return (
    <div>
      <div data-app-tab-active="">
        <div data-keyboard-home="1">
          <div aria-label="Tab reply" contentEditable role="textbox" />
        </div>
      </div>
      <div data-composer-column="">
        <ComposerDock first={cards[0]}>
          {(card) => (
            // Keyed as the app's cards are, so one going takes its button with it.
            <div className="h-24" key={card.id}>
              <button type="button">{`Answer ${card.id}`}</button>
            </div>
          )}
        </ComposerDock>
        <div data-keyboard-home="1">
          <div aria-label="Reply" contentEditable role="textbox" />
        </div>
      </div>
    </div>
  );
}

function dockOf(container: HTMLElement) {
  const dock = container.querySelector<HTMLElement>("[data-composer-dock]");
  if (!dock) {
    throw new Error("No dock on show");
  }
  return dock;
}

/**
 * The dock's height on each frame from now until it stops changing, read
 * from the page. Transitions run in no time here (`setup-browser.ts`), so
 * this sees where each one starts and ends, not the frames between.
 */
async function heightsOf(container: HTMLElement) {
  const heights: number[] = [];
  let still = 0;
  while (still < 5) {
    await new Promise(requestAnimationFrame);
    const height =
      container.querySelector<HTMLElement>("[data-composer-dock]")
        ?.offsetHeight ?? 0;
    still = heights.at(-1) === height ? still + 1 : 0;
    heights.push(height);
  }
  return [...new Set(heights)];
}

it("opens from nothing to the card's height, and folds back to nothing once it goes, on the fold's curve", async () => {
  // Its height as it is first drawn, before the frame it opens on.
  let first: number | undefined;
  const watch = new MutationObserver(() => {
    first ??= document.querySelector<HTMLElement>(
      "[data-composer-dock]",
    )?.offsetHeight;
  });
  watch.observe(document.body, { childList: true, subtree: true });
  const screen = await renderInBrowser(<Column cards={[{ id: "a" }]} />);
  watch.disconnect();
  const dock = dockOf(screen.container);
  expect(first).toBe(0);
  expect(await heightsOf(screen.container)).toEqual([96]);
  expect(dock.style.transitionDuration).toBe("240ms");
  expect(dock.style.transitionTimingFunction).toBe(
    "cubic-bezier(0.32, 0.72, 0, 1)",
  );

  await screen.rerender(<Column cards={[]} />);
  expect(dock.hasAttribute("inert")).toBe(true);
  expect(await heightsOf(screen.container)).toEqual([0]);
  await expect
    .poll(() => screen.container.querySelector("[data-composer-dock]"))
    .toBeNull();
});

it("hands the keyboard in a card that goes to the card that takes its place", async () => {
  const screen = await renderInBrowser(
    <Column cards={[{ id: "a" }, { id: "b" }]} />,
  );
  screen.getByRole("button", { name: "Answer a" }).element().focus();

  await screen.rerender(<Column cards={[{ id: "b" }]} />);

  await expect
    .element(screen.getByRole("button", { name: "Answer b" }))
    .toHaveFocus();
});

it("hands the keyboard in the last card to the reply box under it, not the tab's", async () => {
  const screen = await renderInBrowser(<Column cards={[{ id: "a" }]} />);
  screen.getByRole("button", { name: "Answer a" }).element().focus();

  await screen.rerender(<Column cards={[]} />);

  await expect
    .element(screen.getByRole("textbox", { name: "Reply", exact: true }))
    .toHaveFocus();
});

it("leaves the keyboard where it was when it was not in the card", async () => {
  const screen = await renderInBrowser(
    <Column cards={[{ id: "a" }, { id: "b" }]} />,
  );
  const reply = screen.getByRole("textbox", { name: "Reply", exact: true });
  reply.element().focus();

  await screen.rerender(<Column cards={[{ id: "b" }]} />);
  await expect.element(reply).toHaveFocus();
  await screen.rerender(<Column cards={[]} />);
  await expect.element(reply).toHaveFocus();
});
