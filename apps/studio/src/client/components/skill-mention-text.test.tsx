import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

// Relative, not `@/tests/render`: oxlint's type-aware pass does not resolve the
// alias to this module and every access downstream then reads as an error type.
import { renderWithProviders } from "../../tests/render";
import { SkillMentionText } from "./skill-mention-text";

it("shows a quoted path as its chip, without the quotes", () => {
  const { container } = renderWithProviders(
    <SkillMentionText text={'look at "/Users/casey/My Docs" dude'} />,
  );

  expect(screen.getByText("/Users/casey/My Docs")).toBeTruthy();
  expect(container.textContent).toBe("look at /Users/casey/My Docs dude");
});

it("keeps quotes around words that are no path", () => {
  const { container } = renderWithProviders(
    <SkillMentionText text={'she said "hello there" to me'} />,
  );

  expect(container.textContent).toBe('she said "hello there" to me');
});
