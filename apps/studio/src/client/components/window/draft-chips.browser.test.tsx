import { type WindowTab } from "@/client/atoms/window";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type ChosenItem, type Draft } from "@/shared/drafts";
import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ContextChips } from "./context-chip";
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

/** A draft's chip row over whatever the window has in view. */
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
  const { items, leaveOut } = useDraftChips({
    allTabs: [],
    bandUp: undefined,
    draft,
    finderOf: (id) => (id === inView.id ? finder : null),
    inView,
    onChange: setDraft,
  });
  return (
    <div data-testid="chips">
      <ContextChips items={items} onLeaveOut={leaveOut} />
    </div>
  );
}

const chipNames = () =>
  [
    ...page
      .getByTestId("chips")
      .element()
      .querySelectorAll("button[aria-label^='Leave out ']"),
  ].map((button) => button.getAttribute("aria-label"));

describe("a draft's screen chips", () => {
  it("stay dismissed while the window goes elsewhere and back, and never name the chat on screen", async () => {
    const { rerender } = await renderInBrowser(<Chips inView={PLAN} />);
    await expect.poll(chipNames).toEqual(["Leave out plan.md"]);

    await userEvent.click(
      page.getByRole("button", { name: "Leave out plan.md" }),
    );
    await expect.poll(chipNames).toEqual([]);

    await rerender(<Chips inView={DOCUMENTS} />);
    await expect.poll(chipNames).toEqual(["Leave out Documents"]);

    await rerender(<Chips inView={PLAN} />);
    await expect.poll(chipNames).toEqual([]);

    await rerender(<Chips inView={CHAT_SCREEN} />);
    await expect.poll(chipNames).toEqual([]);
  });

  // Ask over a file selected in a folder: the draft is made with the file,
  // and the Finder in view stands for its folder beside it.
  it("leaves out the one chip pressed of two, and keeps it out across a screen switch", async () => {
    const output = "/Users/casey/documents-output";
    const plan = { kind: "file" as const, path: `${output}/plan.md` };
    const folder = screen(folderHref(output));
    const finder = { folder: output, selected: [plan] };
    const asked: Draft = { ...DRAFT, context: [plan] };
    const { rerender } = await renderInBrowser(
      <Chips finder={finder} inView={folder} opened={asked} />,
    );
    await expect
      .poll(chipNames)
      .toEqual(["Leave out documents-output", "Leave out plan.md"]);

    await userEvent.click(
      page.getByRole("button", { name: "Leave out plan.md" }),
    );
    await expect.poll(chipNames).toEqual(["Leave out documents-output"]);

    await rerender(
      <Chips
        finder={{ folder: `${output}/Notes`, selected: [] }}
        inView={screen(folderHref(`${output}/Notes`))}
        opened={asked}
      />,
    );
    await expect.poll(chipNames).toEqual(["Leave out Notes"]);

    await rerender(<Chips finder={finder} inView={folder} opened={asked} />);
    await expect.poll(chipNames).toEqual(["Leave out documents-output"]);
  });
});
