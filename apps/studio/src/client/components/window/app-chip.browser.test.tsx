import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { AppChip } from "./app-chip";

/** The chip at the head of a field as wide as `width`, a name after it. */
const field = (width: number) => (
  <div className="@container/field flex" style={{ width }}>
    <AppChip app="files" nameFolds />
    <span>todo.md</span>
  </div>
);

describe("the app chip in the address field", () => {
  it.each([
    {
      name: "says its app's name in a field with room",
      shown: true,
      width: 400,
    },
    {
      name: "shows its mark alone in a narrow field",
      shown: false,
      width: 250,
    },
  ])("$name", async ({ shown, width }) => {
    await renderInBrowser(field(width));
    const name = page.getByText("Files").element();
    expect(name.getBoundingClientRect().width > 1).toBe(shown);
  });
});
