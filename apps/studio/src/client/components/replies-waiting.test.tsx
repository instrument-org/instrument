import { type ChatBoxes, chatBoxesAtom } from "@/client/drafts/chat-box";
import { resetDrafts } from "@/client/drafts/store";
import { type Draft } from "@/shared/drafts";
import { renderWithProviders } from "@/tests/render";
import { type ChatId } from "@instrument-org/workspace/client";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepliesWaiting } from "./replies-waiting";

const CHAT = "2026-10-16-dishwashers" as ChatId;
const OTHER_CHAT = "2026-10-16-taxes" as ChatId;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();

/** A reply waiting, written whole days ago so its age reads the same every run. */
function reply(id: string, daysAgo: number, words: string): Draft {
  const updatedAt = NOW - daysAgo * DAY_MS;
  return { chatId: CHAT, createdAt: updatedAt, id, updatedAt, words };
}

function show(drafts: Draft[], boxes: ChatBoxes = {}, disabled = false) {
  const onSwapIn = vi.fn();
  resetDrafts(drafts);
  const { store } = renderWithProviders(
    <RepliesWaiting chatId={CHAT} disabled={disabled} onSwapIn={onSwapIn} />,
  );
  act(() => {
    store.set(chatBoxesAtom, boxes);
  });
  return { onSwapIn };
}

afterEach(() => {
  resetDrafts();
});

/** Opens the menu the way Radix opens it, on the press rather than the click. */
function openMenu() {
  const trigger = screen.getByRole("button");
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.pointerUp(trigger, { button: 0, ctrlKey: false });
  return trigger;
}

describe("a chat's other replies waiting", () => {
  it("says nothing where the chat has one reply waiting", () => {
    show([reply("only", 1, "Thanks, that worked")]);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts the ones that are not in the box", () => {
    show([
      reply("first", 3, "one"),
      reply("second", 2, "two"),
      reply("third", 1, "three"),
    ]);

    expect(openMenu().textContent).toBe("2 other replies waiting");
  });

  it("counts one on its own", () => {
    show([reply("first", 2, "one"), reply("second", 1, "two")]);

    expect(openMenu().textContent).toBe("1 other reply waiting");
  });

  it("counts them all, and says nothing of others, where the box is writing into none", () => {
    show([reply("first", 2, "one"), reply("second", 1, "two")], {
      [CHAT]: null,
    });

    expect(openMenu().textContent).toBe("2 replies waiting");
  });

  it("offers the chat's one reply where its box was emptied", () => {
    const { onSwapIn } = show([reply("only", 1, "Thanks, that worked")], {
      [CHAT]: null,
    });

    expect(openMenu().textContent).toBe("1 reply waiting");
    fireEvent.click(screen.getByText("Thanks, that worked"));

    expect(onSwapIn).toHaveBeenCalledWith("only");
  });

  it("opens no menu while the box is dictating", () => {
    const { onSwapIn } = show(
      [reply("first", 2, "one"), reply("second", 1, "two")],
      {},
      true,
    );

    expect(openMenu()).toHaveProperty("disabled", true);
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(onSwapIn).not.toHaveBeenCalled();
  });

  it("counts no reply of another chat's", () => {
    show([
      reply("first", 2, "one"),
      reply("second", 1, "two"),
      {
        chatId: OTHER_CHAT,
        createdAt: NOW,
        id: "elsewhere",
        updatedAt: NOW,
        words: "another chat's",
      },
      {
        createdAt: NOW,
        id: "new-chat",
        updatedAt: NOW,
        words: "a chat of its own",
      },
    ]);

    expect(openMenu().textContent).toBe("1 other reply waiting");
  });

  it("offers each by its words, newest first, and swaps the one picked in", () => {
    const { onSwapIn } = show([
      reply("first", 3, "The first thing I meant to ask"),
      reply("second", 2, "The second thing"),
      reply("third", 1, "What is in the box"),
    ]);
    openMenu();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent))
      .toMatchInlineSnapshot(`
      [
        "The second thing2 days ago",
        "The first thing I meant to ask3 days ago",
      ]
    `);

    fireEvent.click(screen.getByText("The first thing I meant to ask"));

    expect(onSwapIn).toHaveBeenCalledWith("first");
  });
});
