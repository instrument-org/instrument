import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { type Stopped, StoppedContext, StoppedLine } from "./stopped-line";

afterEach(cleanup);

function text(stopped: Stopped | undefined) {
  const { container } = render(
    <StoppedContext value={stopped}>
      <StoppedLine />
    </StoppedContext>,
  );
  return container.textContent;
}

it("says nothing unless the person's stop holds", () => {
  expect(text(undefined)).toBe("");
});

it("drops the link while asking for feedback is off", () => {
  expect(text({})).toBe("You stopped Instrument.");
});

it("opens Send feedback from its link", () => {
  const onSendFeedback = vi.fn();
  expect(text({ onSendFeedback })).toBe(
    "You stopped Instrument. If it wasn't working as expected, please send feedback.",
  );
  fireEvent.click(screen.getByRole("button", { name: "send feedback" }));
  expect(onSendFeedback).toHaveBeenCalledOnce();
});
