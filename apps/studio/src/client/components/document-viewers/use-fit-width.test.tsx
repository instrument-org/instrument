import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFitWidth } from "./use-fit-width";

// jsdom lays nothing out, so every element it makes is zero by zero. The width
// is stubbed rather than styled because `clientWidth` is the whole of what the
// fit reads off the container, and a zero one is a state the app reaches too:
// the frame a viewer's scroll container mounts in.
function containerOfWidth(clientWidth: number) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: clientWidth });
  return container;
}

describe("useFitWidth", () => {
  it("scales the content to the container, less a gutter either side", () => {
    const { result } = renderHook(() =>
      useFitWidth({
        container: containerOfWidth(832),
        contentWidth: 1000,
        initialFit: true,
      }),
    );

    expect(result.current.zoom).toBe(0.8);
  });

  // Both are the same wait: something the fit needs has not arrived. Dividing
  // by either would land on the floor of the zoom range, which the control then
  // shows as the document's level until the real one turns up.
  it.each([
    {
      case: "the container has not been laid out",
      container: 0,
      content: 1000,
    },
    { case: "the content's own width is unknown", container: 832, content: 0 },
  ])("holds the opening level while $case", ({ container, content }) => {
    const { result } = renderHook(() =>
      useFitWidth({
        container: containerOfWidth(container),
        contentWidth: content,
        initialFit: true,
      }),
    );

    expect(result.current.zoom).toBe(1);
  });
});
