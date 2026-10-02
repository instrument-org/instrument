// The plus menu hands the model picker the screen: one Radix layer closing as
// another opens, which is a sequence of focus and dismissal events rather than
// a rendered result, so jsdom has nothing to say about it.
import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { renderInBrowser } from "../../tests/render-browser";
import { ComposerAddMenu, type ComposerMenuView } from "./composer-add-menu";
import { ModelPicker } from "./model-picker";

const params = {
  provider: "anthropic" as const,
  providerConfigId: AIProviderConfigIdSchema.parse("browser-test"),
};

const sonnet = AIGatewayModel.Schema.parse({
  author: "anthropic",
  canonicalId: "claude-sonnet-5",
  features: ["inputText", "outputText", "tools"],
  name: "Claude Sonnet 5",
  params,
  providerId: "anthropic/claude-sonnet-5",
  providerName: "Anthropic",
  tags: [],
  uri: AIGatewayModelURI.fromModel({
    author: "anthropic",
    canonicalId: AIGatewayModel.CanonicalIdSchema.parse("claude-sonnet-5"),
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

/** The pill composer's arrangement: the menu, the picker it hands off to, and the prompt. */
function Handoff({ onValueChange }: { onValueChange: (uri: string) => void }) {
  const [bounds, setBounds] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<ComposerMenuView | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div ref={setBounds} style={{ padding: 16, width: 480 }}>
      <div className="relative">
        <ComposerAddMenu
          actions={[
            {
              handsOff: true,
              icon: CpuIcon,
              id: "model",
              label: "Choose a model",
              onSelect: () => {
                setPickerOpen(true);
              },
            },
          ]}
          bounds={bounds}
          onReturnFocus={() => {
            document.querySelector("textarea")?.focus();
          }}
          onSelectSkill={vi.fn()}
          onViewChange={setView}
          skills={[]}
          view={view}
        />
        <ModelPicker
          anchorOnly
          className="pointer-events-none absolute inset-0"
          // The state the ghost showed up in: a picker the composer cannot open
          // on its own, because the models behind it are still arriving or
          // never came.
          disabled
          models={[autoModel, sonnet]}
          modelURI={sonnet.uri}
          onClose={() => {
            setPickerOpen(false);
          }}
          onOpenChange={setPickerOpen}
          onValueChange={onValueChange}
          open={pickerOpen}
          selectedModel={sonnet}
        />
      </div>
      <textarea aria-label="Prompt" />
    </div>
  );
}

describe("the composer's model handoff", () => {
  // The picker used to hang off a button of its own, held at `opacity-0` over
  // the plus. Which is invisible right up until the button is disabled, since
  // `disabled:opacity-50` outranks it: the provider icon, the model's name and
  // a caret then paint at half opacity across the plus, and the composer wears
  // a ghost of a control nobody put there.
  it("paints nothing over the button it hangs off", async () => {
    await renderInBrowser(<Handoff onValueChange={vi.fn()} />);

    await expect
      .element(page.getByRole("button", { name: "Add to this prompt" }))
      .toBeVisible();

    // No second control over the plus, announced or drawn: what the panel hangs
    // off is an empty box.
    await expect
      .element(page.getByRole("combobox", { name: "Model" }))
      .not.toBeInTheDocument();
    const anchor = document.querySelector("[data-slot=popover-anchor]");
    expect(anchor?.textContent).toBe("");
    expect(anchor?.children).toHaveLength(0);
  });

  // The picker used to open and vanish: the menu closing under the pointer
  // takes focus back to its own content, and the layer that had just opened
  // reads that as focus landing outside itself and dismisses.
  it("keeps the picker open once the menu that opened it has closed", async () => {
    const onValueChange = vi.fn();
    await renderInBrowser(<Handoff onValueChange={onValueChange} />);

    await userEvent.click(
      page.getByRole("button", { name: "Add to this prompt" }),
    );
    await userEvent.click(
      page.getByRole("menuitem", { name: "Choose a model" }),
    );

    await expect.element(page.getByRole("dialog")).toBeVisible();

    // The menu's own teardown runs a tick after the click, and its exit
    // animation a good while after that, so a picker still up here is one that
    // outlived both.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect
      .element(page.getByRole("combobox", { name: "Search models" }))
      .toBeVisible();

    // And is still a picker: what the handoff is for is the choice at the end
    // of it.
    await userEvent.click(
      page.getByRole("option", { name: /Claude Sonnet 5/ }),
    );
    expect(onValueChange).toHaveBeenCalledWith(sonnet.uri);
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });
});
