import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReasoningMessage } from "./reasoning-message";

// The row measures a running thought against now, so a case picks its elapsed
// time by choosing how far back the thought started.
function renderStartedAgo(ms: number, { isLoading = true } = {}) {
  const createdAt = new Date(Date.now() - ms);
  return renderWithProviders(
    <ReasoningMessage
      createdAt={createdAt}
      endedAt={isLoading ? undefined : new Date()}
      isLoading={isLoading}
      text="weighing it up"
    />,
  );
}

// A clock on a row that is still going invites the reader to watch it, and for
// the first few seconds there is nothing to watch.
describe("ReasoningMessage while the thought is still running", () => {
  it("says only that it is thinking, for the first few seconds", () => {
    renderStartedAgo(500);

    expect(screen.getByText("Thinking")).toBeDefined();
  });

  it("still says only that at just under the threshold", () => {
    renderStartedAgo(2500);

    expect(screen.getByText("Thinking")).toBeDefined();
  });

  it("counts up once the wait is worth remarking on", () => {
    renderStartedAgo(5000);

    expect(screen.getByText("Thinking for 5s")).toBeDefined();
  });
});

// The number is the answer there rather than a ticker, so it reports whatever
// the thought took.
describe("ReasoningMessage once the thought is over", () => {
  it("reports a second, short as that is", () => {
    renderStartedAgo(1000, { isLoading: false });

    expect(screen.getByText("Thought for 1s")).toBeDefined();
  });
});
