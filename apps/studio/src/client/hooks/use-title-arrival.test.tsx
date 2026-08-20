import { type TaskId } from "@instrument-org/workspace/client";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { markTitleRenamedByUser, useTitleArrival } from "./use-title-arrival";

// Each test names its own task, since a rename is remembered for the rest of
// the session and the module is shared across the file.
const taskId = (name: string) => name as TaskId;

const renderTitle = (id: TaskId, title: string) =>
  renderHook((next: string) => useTitleArrival(id, next), {
    initialProps: title,
  });

describe("useTitleArrival", () => {
  it("leaves a title that was already there alone", () => {
    const { result } = renderTitle(taskId("mounted"), "Untitled task");

    expect(result.current.className).toBeUndefined();
  });

  it("sweeps in a name the reader did not type", () => {
    const { rerender, result } = renderTitle(taskId("named"), "make me a card");

    rerender("Sailing birthday card for dad");
    expect(result.current.className).toBe("title-arrival");
  });

  it("settles once the sweep has run", () => {
    const { rerender, result } = renderTitle(taskId("settles"), "hi");

    rerender("Duplicates in the contacts export");
    act(() => {
      result.current.onAnimationEnd();
    });
    expect(result.current.className).toBeUndefined();
  });

  it("sweeps again on the next name", () => {
    const { rerender, result } = renderTitle(taskId("again"), "hi");

    rerender("Duplicates in the contacts export");
    act(() => {
      result.current.onAnimationEnd();
    });
    rerender("Contacts export deduped");
    expect(result.current.className).toBe("title-arrival");
  });

  it("stays put for the reader's own rename", () => {
    const id = taskId("renamed");
    const { rerender, result } = renderTitle(id, "Sailing birthday card");

    markTitleRenamedByUser(id, "Dad's card");
    rerender("Dad's card");
    expect(result.current.className).toBeUndefined();
  });

  it("matches the reader's rename after the write trims it", () => {
    const id = taskId("untrimmed");
    const { rerender, result } = renderTitle(id, "Sailing birthday card");

    markTitleRenamedByUser(id, "  Dad's card  ");
    rerender("Dad's card");
    expect(result.current.className).toBeUndefined();
  });

  it("suppresses only the name the reader typed, not the one after it", () => {
    const id = taskId("then-generated");
    const { rerender, result } = renderTitle(id, "Sailing birthday card");

    markTitleRenamedByUser(id, "Dad's card");
    rerender("Dad's card");
    rerender("Sailing card for dad's birthday");
    expect(result.current.className).toBe("title-arrival");
  });

  it("keeps a rename quiet in a second place showing the same task", () => {
    const id = taskId("two-places");
    const sidebar = renderTitle(id, "Sailing birthday card");
    const header = renderTitle(id, "Sailing birthday card");

    markTitleRenamedByUser(id, "Dad's card");
    sidebar.rerender("Dad's card");
    header.rerender("Dad's card");

    expect(sidebar.result.current.className).toBeUndefined();
    expect(header.result.current.className).toBeUndefined();
  });
});
