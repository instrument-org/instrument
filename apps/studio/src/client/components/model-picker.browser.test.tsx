import { zoomAtom } from "@/client/atoms/zoom";
import { ariaSnapshot } from "@/tests/aria-snapshot";
import { renderInBrowser } from "@/tests/render-browser";
import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ModelPicker } from "./model-picker";

// What the picker offers has to be legible from the accessibility tree, since
// that tree is both what a screen reader announces and what an agent driving
// the app reads. On Auto the model list is deliberately folded away, and a fold
// that leaves nothing behind is indistinguishable from a picker that has one
// model in it -- which is what an agent driving Studio concluded, before
// working around the UI entirely.

const params = {
  provider: "anthropic" as const,
  providerConfigId: AIProviderConfigIdSchema.parse("browser-test"),
};

const model = ({
  author = "anthropic",
  canonicalId,
  name,
  providerName = "Anthropic",
  tags = [],
}: {
  author?: string;
  canonicalId: string;
  name: string;
  providerName?: string;
  tags?: string[];
}) =>
  AIGatewayModel.Schema.parse({
    author,
    canonicalId,
    features: ["inputText", "outputText", "tools"],
    name,
    params,
    providerId: `${author}/${canonicalId}`,
    providerName,
    tags,
    uri: AIGatewayModelURI.fromModel({
      author,
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
      params,
    }),
  });

const autoModel = AIGatewayModel.Schema.parse({
  author: OUR_MODELS.author,
  canonicalId: "auto",
  features: ["inputText", "outputText", "tools"],
  name: "Auto",
  params,
  providerId: OUR_MODELS.text.id,
  providerName: "Instrument",
  tags: [],
  uri: AIGatewayModelURI.fromModel({
    author: OUR_MODELS.author,
    canonicalId: AIGatewayModel.CanonicalIdSchema.parse("auto"),
    params,
  }),
});

const sonnet = model({
  canonicalId: "claude-sonnet-5",
  name: "Claude Sonnet 5",
  tags: ["recommended", "coding", "default"],
});

const models = [
  autoModel,
  model({
    canonicalId: "claude-opus-5",
    name: "Claude Opus 5",
    tags: ["recommended", "coding"],
  }),
  sonnet,
  model({ canonicalId: "claude-haiku-4-5", name: "Claude Haiku 4.5" }),
];

/**
 * How far the first row starts below the top of the list holding it, which is
 * nowhere: the list is sized and placed to hold exactly its rows. Row offsets
 * are counted from the top of the panel's scroll, so leaving them uncorrected
 * pushes every row down by the height of the chrome above the list -- and the
 * bottom of the list cannot see that, since the overhang lengthens the scroll
 * it hangs off the end of.
 */
function gapAboveFirstRow(scroll: HTMLElement) {
  const list = scroll.querySelector("[data-slot=model-list]");
  const first = list?.firstElementChild;
  return list instanceof HTMLElement && first instanceof HTMLElement
    ? first.getBoundingClientRect().top - list.getBoundingClientRect().top
    : Number.NaN;
}

/**
 * Scrolls to the end of the panel and reports how far the last row stops short
 * of it. Both halves are re-asked for rather than done once: rows size
 * themselves as they render, so the scroll being reached for grows while it is
 * reached for, and the virtualizer draws the range for a scroll a frame after
 * the scroll itself. The last row is whichever is rendered highest rather than
 * whichever model sorts last, since at the end of the scroll there is nothing
 * below it.
 */
function gapBelowLastRow(scroll: HTMLElement) {
  scroll.scrollTop = scroll.scrollHeight;
  const rows = [
    ...scroll.querySelectorAll("[data-slot=model-list] > [data-index]"),
  ];
  const last = rows.at(-1);
  return last instanceof HTMLElement
    ? scroll.getBoundingClientRect().bottom -
        last.getBoundingClientRect().bottom
    : Number.NaN;
}

/** The panel's one scroll: the Auto row, the search field and the model list. */
function scrollOf(panel: Element) {
  const scroll = panel.querySelector("[data-slot=model-picker-scroll]");
  if (!(scroll instanceof HTMLElement)) {
    throw new TypeError("the panel is open without a scroll in it");
  }
  return scroll;
}

/** Enough to fill the list past the height it would like to have. */
const manyModels = [
  ...models,
  ...Array.from({ length: 30 }, (_, index) =>
    model({
      canonicalId: `claude-filler-${index}`,
      name: `Claude Filler ${index}`,
    }),
  ),
];

/** Enough that rendering all of them would be the whole cost of opening. */
const crowdedModels = [
  autoModel,
  ...Array.from({ length: 200 }, (_, index) =>
    model({
      canonicalId: `claude-crowd-${index}`,
      name: `Claude Crowd ${index}`,
    }),
  ),
];

async function openPicker(selectedModel: AIGatewayModel.Type) {
  await renderInBrowser(
    <ModelPicker
      models={models}
      modelURI={selectedModel.uri}
      onValueChange={vi.fn()}
      selectedModel={selectedModel}
    />,
  );

  await userEvent.click(page.getByRole("combobox", { name: "Model" }));

  return () => ariaSnapshot("[data-slot=command]");
}

describe("ModelPicker in a browser", () => {
  it("says how many models the fold is holding while Auto is selected", async () => {
    const tree = await openPicker(autoModel);

    expect(await tree()).toMatchInlineSnapshot(`
      "- text: Search models Auto
      - switch "Auto Selects the best model for your task" [checked]
      - text: Selects the best model for your task
      - combobox "Search models" [expanded]
      - listbox "Suggestions"
      - button "Browse 3 models""
    `);
  });

  it("opens the list from the folded state without a search", async () => {
    const tree = await openPicker(autoModel);

    await userEvent.click(
      page.getByRole("button", { name: "Browse 3 models" }),
    );

    expect(await tree()).toMatchInlineSnapshot(`
      "- text: Search models Auto
      - switch "Auto Selects the best model for your task" [checked]
      - text: Selects the best model for your task
      - separator
      - combobox "Search models" [expanded]
      - listbox "Suggestions":
        - text: Recommended
        - option "Claude Opus 5 Anthropic" [selected]:
          - text: Claude Opus 5
          - img
          - text: Anthropic
        - option "Claude Sonnet 5 Anthropic":
          - text: Claude Sonnet 5
          - img
          - text: Anthropic
        - text: Other
        - option "Claude Haiku 4.5 Anthropic":
          - text: Claude Haiku 4.5
          - img
          - text: Anthropic"
    `);
  });

  it("names every model it offers while one is picked", async () => {
    const tree = await openPicker(sonnet);

    expect(await tree()).toMatchInlineSnapshot(`
      "- text: Search models Auto
      - switch "Auto Selects the best model for your task"
      - text: Selects the best model for your task
      - separator
      - combobox "Search models" [expanded]
      - listbox "Suggestions":
        - text: Recommended
        - option "Claude Opus 5 Anthropic" [selected]:
          - text: Claude Opus 5
          - img
          - text: Anthropic
        - option "Claude Sonnet 5 Anthropic":
          - text: Claude Sonnet 5
          - img
          - text: Anthropic
        - text: Other
        - option "Claude Haiku 4.5 Anthropic":
          - text: Claude Haiku 4.5
          - img
          - text: Anthropic"
    `);
  });

  // The list is the one part of the panel with room to give, and nothing else
  // was giving it a ceiling: the panel took the height its contents wanted and
  // hung off the top and bottom of the window. Zoom is where it shows up first,
  // because a panel measured in layout pixels is drawn `zoom x` that tall.
  it("stays inside the window with the list open and the UI zoomed in", async () => {
    const store = createStore();
    store.set(zoomAtom, 2);

    await renderInBrowser(
      // Far enough down the window that neither side of the trigger has room
      // for the full list, which is what the panel has to notice.
      <div style={{ paddingTop: 200 }}>
        <ModelPicker
          models={manyModels}
          modelURI={sonnet.uri}
          onValueChange={vi.fn()}
          selectedModel={sonnet}
        />
      </div>,
      { store },
    );

    await userEvent.click(page.getByRole("combobox", { name: "Model" }));

    const panel = page.getByRole("dialog");
    await expect.element(panel).toBeVisible();

    const viewportHeight = document.documentElement.clientHeight;
    await expect
      .poll(() => Math.round(panel.element().getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(viewportHeight);

    const { height, top } = panel.element().getBoundingClientRect();
    expect(top).toBeGreaterThanOrEqual(0);
    expect(height).toBeLessThanOrEqual(viewportHeight);

    // Fitting is only half of it: the panel clips what overflows it, so one
    // that kept its full height would pass everything above while hiding its
    // last rows behind an edge with no way to reach them.
    const scroll = scrollOf(panel.element());
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  });

  // The panel's height comes from a variable Radix publishes once it has
  // measured, which is after the first paint -- and a `max-height` reading a
  // variable that is not there yet is not a loose cap but no cap at all. The
  // list measures the unbounded panel it is sitting in, concludes that all of
  // it is on screen, and renders every row. Nothing looks wrong afterwards,
  // because the cap lands and the panel snaps to it; the only trace is that
  // opening the picker took as long as building the whole list.
  it("renders only the rows that fit, from the first open", async () => {
    await renderInBrowser(
      <ModelPicker
        models={crowdedModels}
        modelURI={crowdedModels[1]?.uri}
        onValueChange={vi.fn()}
        selectedModel={crowdedModels[1]}
      />,
    );

    // The high-water mark rather than the count at the end, because the cap
    // does arrive: a panel that rendered all 200 rows on its first paint has
    // thrown them away again by the time it settles, leaving nothing to assert
    // on afterwards.
    let peak = 0;
    const observer = new MutationObserver(() => {
      peak = Math.max(
        peak,
        document.querySelectorAll("[data-slot=model-list] > [data-index]")
          .length,
      );
    });
    observer.observe(document.body, { childList: true, subtree: true });

    await userEvent.click(page.getByRole("combobox", { name: "Model" }));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    observer.disconnect();

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(crowdedModels.length / 4);
  });

  // The Auto row and the search field used to hold their height whatever else
  // had to give, which in a short window left the model list a sliver of the
  // panel to scroll inside. Only the search field is worth that: it is what a
  // list too long to read is searched with.
  it("scrolls the Auto row away and keeps the search field", async () => {
    await renderInBrowser(
      <ModelPicker
        models={manyModels}
        modelURI={sonnet.uri}
        onValueChange={vi.fn()}
        selectedModel={sonnet}
      />,
    );

    await userEvent.click(page.getByRole("combobox", { name: "Model" }));

    const panel = page.getByRole("dialog");
    await expect.element(panel).toBeVisible();

    const scroll = scrollOf(panel.element());
    const auto = page.getByRole("switch", { name: /Auto/ }).element();
    const search = page.getByRole("combobox", { name: "Search models" });

    // Both ends of the list, because each catches a different way of counting
    // the offsets wrong.
    await expect.poll(() => gapAboveFirstRow(scroll)).toBeLessThan(1);
    expect(gapAboveFirstRow(scroll)).toBeGreaterThanOrEqual(-1);

    await expect.poll(() => gapBelowLastRow(scroll)).toBeLessThan(4);
    expect(gapBelowLastRow(scroll)).toBeGreaterThanOrEqual(-1);

    const scrolled = scroll.getBoundingClientRect();
    expect(auto.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scrolled.top + 1,
    );
    expect(search.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      scrolled.top - 1,
    );
  });
});
