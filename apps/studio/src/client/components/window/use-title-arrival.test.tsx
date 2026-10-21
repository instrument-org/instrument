import { ChatIdSchema } from "@instrument-org/workspace/client";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTitleArrival } from "./use-title-arrival";

type Shown = Parameters<typeof useTitleArrival>[0];

const chat = (id: string, title: string, titleByApp = true): Shown => ({
  id: ChatIdSchema.parse(`2026-10-20-${id}`),
  title,
  titleByApp,
});

const renderTitle = (initial: Shown) =>
  renderHook((shown: Shown) => useTitleArrival(shown), {
    initialProps: initial,
  });

describe("useTitleArrival", () => {
  it("leaves a title that was already there alone", () => {
    const { result } = renderTitle(chat("a", "Sailing card for dad"));

    expect(result.current.className).toBeUndefined();
  });

  it("sweeps in a name the app gave", () => {
    const { rerender, result } = renderTitle(chat("a", "make me a card"));

    rerender(chat("a", "Sailing card for dad"));
    expect(result.current.className).toBe("title-arrival");
  });

  it("stays put for a name the person typed", () => {
    const { rerender, result } = renderTitle(chat("a", "Sailing card"));

    rerender(chat("a", "Dad's card", false));
    expect(result.current.className).toBeUndefined();
  });

  it("stays put for the same title rendered again", () => {
    const { rerender, result } = renderTitle(chat("a", "Sailing card"));

    rerender(chat("a", "Sailing card"));
    expect(result.current.className).toBeUndefined();
  });

  it("stays put when the element is handed another chat", () => {
    const { rerender, result } = renderTitle(chat("a", "Sailing card"));

    rerender(chat("b", "Duplicates in the export"));
    expect(result.current.className).toBeUndefined();
  });

  it("sweeps a name arriving after the element changed chat", () => {
    const { rerender, result } = renderTitle(chat("a", "Sailing card"));

    rerender(chat("b", "make me a list"));
    rerender(chat("b", "Weekly grocery list"));
    expect(result.current.className).toBe("title-arrival");
  });

  it("settles once the sweep has run, and sweeps again on the next name", () => {
    const { rerender, result } = renderTitle(chat("a", "hi"));

    rerender(chat("a", "Duplicates in the contacts export"));
    act(() => {
      result.current.onAnimationEnd();
    });
    expect(result.current.className).toBeUndefined();

    rerender(chat("a", "Contacts export deduped"));
    expect(result.current.className).toBe("title-arrival");
  });

  it("drops a sweep still running when the person renames over it", () => {
    const { rerender, result } = renderTitle(chat("a", "hi"));

    rerender(chat("a", "Duplicates in the contacts export"));
    rerender(chat("a", "Contacts", false));
    expect(result.current.className).toBeUndefined();
  });
});
