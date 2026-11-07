import { type WindowTab } from "@/client/atoms/window";
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  type ChosenItem,
  type Draft,
  type DraftContextItem,
  draftGroupOf,
} from "@/shared/drafts";
import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ContextChips, ContextSuggestion } from "./context-chip";
import { type BandTarget, targetsOf } from "./draft-band";
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
const GROUP = draftGroupOf(DRAFT.id);

/** The window's own tab, standing on one screen after another. */
const screen = (href: string): WindowTab => ({
  href,
  id: "own",
  kind: "screen",
});
const PLAN = screen(fileHref("/Users/casey/Notes/plan.md"));
const DOCUMENTS = screen(folderHref("/Users/casey/Documents"));
const CHAT_SCREEN = screen(chatHref(CHAT));

let opened = 0;

/** The tab a target opens as in the band, as the window opens it. */
function bandTabOf(target: BandTarget): WindowTab {
  const id = `band-${opened++}`;
  if (target.kind === "page") {
    return { group: GROUP, id, kind: "page", openedAt: 0, url: target.url };
  }
  return {
    group: GROUP,
    href:
      target.kind === "screen"
        ? target.href
        : target.kind === "file"
          ? fileHref(target.path)
          : folderHref(target.path),
    id,
    kind: "screen",
  };
}

const lineOf = (entry: DraftContextItem) =>
  entry.kind === "link"
    ? entry.url
    : entry.kind === "chat"
      ? entry.chat
      : entry.path;

/**
 * A draft's chip row, and what the window has in view offered beside it,
 * with taking it opening it as a tab of the draft's band. The draft's lines
 * of `context`, as its file has them, stand in `data-context`, and how many
 * tabs its band has in `data-band`.
 */
function Chips({
  draft: given = DRAFT,
  elsewhere,
  finder = null,
  inView,
}: {
  draft?: Draft;
  /** What another device does to the draft's file, on pressing "Elsewhere". */
  elsewhere?: (draft: Draft) => Draft;
  /** What the Finder on the tab in view shows, when it is a folder's. */
  finder?: null | { folder: string; selected: ChosenItem[] };
  inView: WindowTab;
}) {
  const [draft, setDraft] = useState(given);
  const [band, setBand] = useState<WindowTab[]>([]);
  const open = (target: BandTarget) => {
    const tab = bandTabOf(target);
    setBand((current) => [...current, tab]);
    return tab.id;
  };
  const { items, leaveOut, suggestion } = useDraftChips({
    allTabs: band,
    band,
    closeTab: (id) => {
      setBand((current) => current.filter((tab) => tab.id !== id));
    },
    draft,
    finderOf: (id) => (id === inView.id ? finder : null),
    inView,
    onChange: setDraft,
    open,
  });
  return (
    <div
      data-band={band.length}
      data-context={(draft.context ?? []).map(lineOf).join(" ")}
      data-testid="chips"
    >
      <ContextChips items={items} onLeaveOut={leaveOut} />
      {elsewhere ? (
        <button
          onClick={() => {
            setDraft(elsewhere);
          }}
          type="button"
        >
          Elsewhere
        </button>
      ) : undefined}
      {suggestion ? (
        <ContextSuggestion
          item={suggestion}
          onTake={() => {
            for (const target of targetsOf(suggestion)) {
              open(target);
            }
          }}
        />
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
const attribute = (name: string) => () =>
  page.getByTestId("chips").element().getAttribute(name);
const lines = attribute("data-context");
const bandSize = attribute("data-band");

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

  // A file selected in a folder is what is offered; once taken, the folder
  // around it is not offered in its place.
  it("offer the file selected in a folder, and nothing once it is taken", async () => {
    const output = "/Users/casey/documents-output";
    const plan = { kind: "file" as const, path: `${output}/plan.md` };
    await renderInBrowser(
      <Chips
        finder={{ folder: output, selected: [plan] }}
        inView={screen(folderHref(output))}
      />,
    );
    await expect.poll(offered).toEqual(["Add plan.md"]);
    await userEvent.click(page.getByRole("button", { name: "Add plan.md" }));
    await expect.poll(chipNames).toEqual(["Leave out plan.md"]);
    expect(offered()).toEqual([]);
  });

  it("write what is taken into the draft's file, and take it out with its chip", async () => {
    await renderInBrowser(<Chips inView={PLAN} />);
    await userEvent.click(page.getByRole("button", { name: "Add plan.md" }));
    await expect.poll(lines).toBe("/Users/casey/Notes/plan.md");
    expect(chipNames()).toEqual(["Leave out plan.md"]);

    await userEvent.click(
      page.getByRole("button", { name: "Leave out plan.md" }),
    );
    await expect.poll(lines).toBe("");
    expect(bandSize()).toBe("0");
  });

  it("open what the draft's file names as tabs, one chip each, and keep it in the file", async () => {
    const report = "https://example.com/report";
    await renderInBrowser(
      <Chips
        draft={{
          ...DRAFT,
          context: [
            { kind: "link", url: report },
            { kind: "folder", path: "/Users/casey/Documents/" },
            { chat: CHAT, kind: "chat" },
          ],
        }}
        inView={CHAT_SCREEN}
      />,
    );
    await expect.poll(bandSize).toBe("2");
    await expect.poll(() => chipNames().length).toBe(3);
    expect(lines()).toBe(`${report} /Users/casey/Documents/ ${CHAT}`);
  });

  it("close the tab of a line another device took out, and leave it out of the file", async () => {
    const report = "https://example.com/report";
    await renderInBrowser(
      <Chips
        draft={{
          ...DRAFT,
          context: [
            { kind: "link", url: report },
            { kind: "folder", path: "/Users/casey/Documents/" },
          ],
        }}
        elsewhere={(draft) => ({
          ...draft,
          context: [{ kind: "folder", path: "/Users/casey/Documents/" }],
        })}
        inView={PLAN}
      />,
    );
    await expect.poll(bandSize).toBe("2");

    await userEvent.click(page.getByRole("button", { name: "Elsewhere" }));
    await expect.poll(bandSize).toBe("1");
    await expect.poll(chipNames).toEqual(["Leave out Documents"]);

    // Taking something else afterward writes the band back without it.
    await userEvent.click(page.getByRole("button", { name: "Add plan.md" }));
    await expect
      .poll(lines)
      .toBe("/Users/casey/Documents/ /Users/casey/Notes/plan.md");
  });
});
