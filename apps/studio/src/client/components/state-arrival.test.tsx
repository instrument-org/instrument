import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StateArrival } from "./state-arrival";

const arriving = (container: HTMLElement) =>
  container.firstElementChild?.classList.contains("state-arrive");

describe("StateArrival", () => {
  it("plays only when a loaded state changes", () => {
    const { container, rerender } = render(
      <StateArrival state={undefined}>x</StateArrival>,
    );
    rerender(<StateArrival state="off">x</StateArrival>);
    expect(arriving(container)).toBe(false);
    rerender(<StateArrival state="off">x</StateArrival>);
    expect(arriving(container)).toBe(false);
    rerender(<StateArrival state="allowed">x</StateArrival>);
    expect(arriving(container)).toBe(true);
  });

  it("plays again on each later change", () => {
    const { container, rerender } = render(
      <StateArrival state="a">x</StateArrival>,
    );
    rerender(<StateArrival state="b">x</StateArrival>);
    const first = container.firstElementChild;
    rerender(<StateArrival state="a">x</StateArrival>);
    expect(arriving(container)).toBe(true);
    expect(container.firstElementChild).not.toBe(first);
  });
});
