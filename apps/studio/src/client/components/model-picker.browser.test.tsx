import { zoomAtom } from "@/client/atoms/zoom";
import { noticeFor, readModelStatus } from "@/client/lib/model-status";
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
// the app reads. The list holds one connection's models at a time, so the
// rail's buttons are named for the models they show: a picker whose tree read
// as one model with nowhere to go is what an agent driving Studio once
// concluded before working around the UI entirely.

const connection = (
  config: string,
  provider: "anthropic" | "instrument",
  providerName: string,
) => {
  const params = {
    provider,
    providerConfigId: AIProviderConfigIdSchema.parse(config),
  };
  return ({
    author = provider === "instrument" ? OUR_MODELS.author : "anthropic",
    canonicalId,
    name,
    replacedBy,
    restricted,
    tags = [],
  }: {
    author?: string;
    canonicalId: string;
    name: string;
    replacedBy?: string;
    restricted?: string;
    tags?: string[];
  }) =>
    AIGatewayModel.Schema.parse({
      author,
      canonicalId,
      features: ["inputText", "outputText", "tools"],
      name,
      params,
      providerId:
        canonicalId === "auto"
          ? OUR_MODELS.text.id
          : `${author}/${canonicalId}`,
      providerName,
      tags,
      ...(replacedBy && { replacedBy }),
      ...(restricted && {
        restricted: { message: restricted, reason: "plan" },
      }),
      uri: AIGatewayModelURI.fromModel({
        author,
        canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
        params,
      }),
    });
};

const instrument = connection("instrument", "instrument", "Instrument");
const anthropic = connection("anthropic-key", "anthropic", "Anthropic");

const autoModel = instrument({ canonicalId: "auto", name: "Auto" });
const sonnet = anthropic({
  canonicalId: "claude-sonnet-5.5",
  name: "Claude Sonnet 5.5",
});
const olderSonnet = anthropic({
  canonicalId: "claude-sonnet-5",
  name: "Claude Sonnet 5",
  replacedBy: "claude-sonnet-5.5",
});

const models = [
  autoModel,
  sonnet,
  olderSonnet,
  anthropic({
    canonicalId: "claude-opus-5.5",
    name: "Claude Opus 5.5",
    restricted: "Claude Opus needs a paid plan.",
  }),
  anthropic({ canonicalId: "claude-haiku-4.5", name: "Claude Haiku 4.5" }),
];

/** Enough to fill the list past the height it would like to have. */
const manyModels = [
  ...models,
  ...Array.from({ length: 30 }, (_, index) =>
    anthropic({
      canonicalId: `claude-filler-${index}`,
      name: `Claude Filler ${index}`,
    }),
  ),
];

/** Enough that rendering all of them would be the whole cost of opening. */
const crowdedModels = [
  autoModel,
  ...Array.from({ length: 200 }, (_, index) =>
    anthropic({
      canonicalId: `claude-crowd-${index}`,
      name: `Claude Crowd ${index}`,
    }),
  ),
];

/** The list's scroll: the notice, the catalog toggle and the rows. */
function scrollOf(panel: Element) {
  const scroll = panel.querySelector("[data-slot=model-picker-scroll]");
  if (!(scroll instanceof HTMLElement)) {
    throw new TypeError("the panel is open without a scroll in it");
  }
  return scroll;
}

async function openPicker(
  selectedModel: AIGatewayModel.Type,
  props: Partial<React.ComponentProps<typeof ModelPicker>> = {},
) {
  await renderInBrowser(
    <ModelPicker
      models={models}
      modelURI={selectedModel.uri}
      onValueChange={vi.fn()}
      selectedModel={selectedModel}
      {...props}
    />,
  );
  await userEvent.click(page.getByRole("combobox", { name: "Model" }));
  return () => ariaSnapshot("[data-slot=command]");
}

describe("ModelPicker in a browser", () => {
  it("opens on Instrument with Auto chosen, the rail naming where the rest are", async () => {
    const tree = await openPicker(autoModel);
    expect(await tree()).toMatchInlineSnapshot(`
      "- text: Search models
      - combobox "Search models" [expanded]
      - navigation "Providers":
        - button "Instrument models":
          - img
          - text: Instrument models
        - button "Anthropic models":
          - img
          - text: Anthropic models
        - button "Add a provider"
      - listbox "Suggestions":
        - option "Auto Recommended Picks the right model for each message, and moves to newer ones as they ship. (chosen)" [selected]:
          - img
          - text: Auto Recommended Picks the right model for each message, and moves to newer ones as they ship. (chosen)"
    `);
  });

  it("opens on the chosen model's connection, older and restricted models saying why", async () => {
    const tree = await openPicker(sonnet);
    expect(await tree()).toMatchInlineSnapshot(`
      "- text: Search models
      - combobox "Search models" [expanded]
      - navigation "Providers":
        - button "Instrument models":
          - img
          - text: Instrument models
        - button "Anthropic models":
          - img
          - text: Anthropic models
        - button "Add a provider"
      - listbox "Suggestions":
        - text: Latest
        - option "Claude Haiku 4.5"
        - option "Claude Sonnet 5.5 (chosen)" [selected]
        - text: Older versions
        - option "Claude Sonnet 5 Replaced by Claude Sonnet 5.5"
        - text: Requires a paid plan
        - option "Claude Opus 5.5 Claude Opus needs a paid plan." [disabled]"
    `);
  });

  it("repeats the composer's notice over the list, and its button does the fix", async () => {
    const onAction = vi.fn();
    const notice = noticeFor(
      readModelStatus({
        dismissedOffers: new Set(),
        models,
        modelURI: olderSonnet.uri,
      }),
    );
    await openPicker(olderSonnet, { notice, onAction });

    await userEvent.click(
      page.getByRole("button", { name: "Switch to Claude Sonnet 5.5" }),
    );
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "switch", model: sonnet }),
    );
  });

  it("will not pick a model the user cannot run", async () => {
    const onValueChange = vi.fn();
    await openPicker(sonnet, { onValueChange });

    const opus = page.getByRole("option", { name: /Claude Opus 5.5/ });
    await expect.element(opus).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(opus, { force: true });
    expect(onValueChange).not.toHaveBeenCalled();
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
      // for the full panel, which is what it has to notice.
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
  // it is on screen, and renders every row.
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
    // thrown them away again by the time it settles.
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

  // A long catalog opens on what we recommend, and a chosen model outside that
  // used to open the picker on a list without it: nothing chosen in sight, as
  // though the choice had been lost.
  it("opens a long catalog whole when the chosen model is not a recommendation", async () => {
    const catalog = [
      autoModel,
      ...Array.from({ length: 30 }, (_, index) =>
        anthropic({
          canonicalId: `claude-catalog-${index}`,
          name: `Claude Catalog ${index}`,
          tags: index < 3 ? ["recommended"] : [],
        }),
      ),
    ];
    const chosen = catalog[20];
    if (!chosen) {
      throw new TypeError("the catalog is shorter than expected");
    }
    await renderInBrowser(
      <ModelPicker
        models={catalog}
        modelURI={chosen.uri}
        onValueChange={vi.fn()}
        selectedModel={chosen}
      />,
    );
    await userEvent.click(page.getByRole("combobox", { name: "Model" }));

    await expect
      .element(page.getByRole("option", { name: `${chosen.name} (chosen)` }))
      .toBeInViewport();
    await expect
      .element(page.getByRole("button", { name: "All" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("opens scrolled to a chosen model far down a long list", async () => {
    const chosen = crowdedModels[150];
    if (!chosen) {
      throw new TypeError("the crowd is shorter than expected");
    }
    await renderInBrowser(
      <ModelPicker
        models={crowdedModels}
        modelURI={chosen.uri}
        onValueChange={vi.fn()}
        selectedModel={chosen}
      />,
    );
    await userEvent.click(page.getByRole("combobox", { name: "Model" }));

    await expect
      .element(page.getByRole("option", { name: `${chosen.name} (chosen)` }))
      .toBeInViewport();
  });
});
