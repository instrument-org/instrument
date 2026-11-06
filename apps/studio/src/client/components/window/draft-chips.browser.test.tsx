import { type WindowTab } from "@/client/atoms/window";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type ChosenItem, type Draft } from "@/shared/drafts";
import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ContextChips, ContextSuggestion } from "./context-chip";
import { useDraftChips } from "./use-draft-chips";
import { chatHref } from "./window-href";

// Every query the chips make (the apps, the computer's volumes) waits
// forever: the chips draw from their tabs alone.
vi.mock("@/client/rpc/client", () => {
  const waiting = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key: string) =>
        key === "queryOptions" || key === "experimental_liveOptions"
          ? () => ({
              queryFn: () => new Promise(() => undefined),
              queryKey: [...path, key],
            })
          : waiting([...path, key]),
    });
  return { rpcClient: waiting([]) };
});

const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");
const DRAFT: Draft = { createdAt: 0, id: "d1", updatedAt: 0, words: "" };

/** The window's own tab, standing on one screen after another. */
const screen = (href: string): WindowTab => ({
  href,
  id: "own",
  kind: "screen",
});
const PLAN = screen(fileHref("/Users/casey/Notes/plan.md"));
const DOCUMENTS = screen(folderHref("/Users/casey/Documents"));
const CHAT_SCREEN = screen(chatHref(CHAT));

/** A draft's chip row, and what the window has in view offered beside it. */
function Chips({
  finder = null,
  inView,
  opened = DRAFT,
}: {
  /** What the Finder on the tab in view shows, when it is a folder's. */
  finder?: null | { folder: string; selected: ChosenItem[] };
  inView: WindowTab;
  /** The draft as it was made. */
  opened?: Draft;
}) {
  const [draft, setDraft] = useState(opened);
  const { items, leaveOut, suggestion, take } = useDraftChips({
    allTabs: [],
    band: [],
    draft,
    finderOf: (id) => (id === inView.id ? finder : null),
    inView,
    onChange: setDraft,
  });
  return (
    <div data-testid="chips">
      <ContextChips items={items} onLeaveOut={leaveOut} />
      {suggestion ? (
        <ContextSuggestion item={suggestion} onTake={take} />
      ) : undefined}
    </div>
  );
}

const namesOf = (selector: string) =>
  [...page.getByTestId("chips").element().querySelectorAll(selector)].map(
    (button) => button.getAttribute("aria-label"),
  );
const chipNames = () => namesOf("button[aria-label^='Leave out ']");
const offered = () => namesOf("[data-slot=context-suggestion]");

describe("a draft's chips", () => {
  it("offer what is in view without carrying it, and never offer the chat on screen", async () => {
    const { rerender } = await renderInBrowser(<Chips inView={PLAN} />);
    await expect.poll(offered).toEqual(["Add plan.md"]);
    expect(chipNames()).toEqual([]);

    await rerender(<Chips inView={DOCUMENTS} />);
    await expect.poll(offered).toEqual(["Add Documents"]);

    await rerender(<Chips inView={CHAT_SCREEN} />);
    await expect.poll(offered).toEqual([]);
  });

  it("keep what was taken across a screen switch until it is taken off", async () => {
    const { rerender } = await renderInBrowser(<Chips inView={PLAN} />);
    await userEvent.click(page.getByRole("button", { name: "Add plan.md" }));
    await expect.poll(chipNames).toEqual(["Leave out plan.md"]);
    expect(offered()).toEqual([]);

    await rerender(<Chips inView={DOCUMENTS} />);
    await expect.poll(offered).toEqual(["Add Documents"]);
    expect(chipNames()).toEqual(["Leave out plan.md"]);

    await userEvent.click(
      page.getByRole("button", { name: "Leave out plan.md" }),
    );
    await expect.poll(chipNames).toEqual([]);
  });

  // Ask over a file selected in a folder: the draft is made with the file,
  // and the Finder in view is offered its folder beside it.
  it("offer the folder in view beside a file chosen in it", async () => {
    const output = "/Users/casey/documents-output";
    const plan = { kind: "file" as const, path: `${output}/plan.md` };
    const finder = { folder: output, selected: [plan] };
    await renderInBrowser(
      <Chips
        finder={finder}
        inView={screen(folderHref(output))}
        opened={{ ...DRAFT, context: [plan] }}
      />,
    );
    await expect.poll(chipNames).toEqual(["Leave out plan.md"]);
    await expect.poll(offered).toEqual(["Add documents-output"]);
  });
});
