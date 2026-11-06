import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShimmerSweep } from "./shimmer-sweep";

const sweep = () => document.querySelector(".shimmer-sweep");

describe("the glint of a shimmering text", () => {
  it("is made anew for a new text, whose glyphs a kept element would not repaint", () => {
    const { rerender } = render(<ShimmerSweep text="A chat" />);
    const first = sweep();
    expect(first?.getAttribute("data-text")).toBe("A chat");

    rerender(<ShimmerSweep text="A chat" />);
    expect(sweep()).toBe(first);

    rerender(<ShimmerSweep text="Named by the app" />);
    expect(sweep()).not.toBe(first);
    expect(sweep()?.getAttribute("data-text")).toBe("Named by the app");
  });
});
