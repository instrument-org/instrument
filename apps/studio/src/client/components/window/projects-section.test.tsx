// The projects over the inbox: their columns, the fold past two rows and the
// section's own fold, which stay drawn while closed so they can animate shut.
// jsdom measures no width, so the section here is two columns across.
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type Project } from "./chats";
import { projectColumns, ProjectsSection } from "./projects-section";

const NAMES = ["Daily", "House", "Money", "Reading", "Taxes", "Travel"];

const PROJECTS: Project[] = NAMES.map((name, index) => ({
  color: "#0f9d6e",
  created: new Date(index),
  id: name.toLowerCase(),
  name,
}));

/** Whether the project's tile can be reached: drawn and not shut away inert. */
function isReachable(name: string) {
  const tile = screen.queryByRole("button", { name });
  return tile !== null && tile.closest("[inert]") === null;
}

function renderSection() {
  return renderWithProviders(
    <ProjectsSection
      // Each project's newest chat in the order the names are listed.
      chats={NAMES.map((name, index) => ({
        archived: false,
        lastUserMessageAt: NAMES.length - index,
        project: name.toLowerCase(),
      }))}
      onChoose={vi.fn()}
      onDetails={vi.fn()}
      onNew={vi.fn()}
      projects={PROJECTS}
    />,
  );
}

describe("projectColumns", () => {
  it("takes columns from the width, and shares one row among fewer projects", () => {
    const widths = [188, 248, 308, 428];
    const rows = [1, 2, 3, 4, 5, 9].map(
      (count) =>
        `${count}: ${widths.map((width) => projectColumns(width, count)).join(" ")}`,
    );
    expect(rows).toMatchInlineSnapshot(`
      [
        "1: 1 1 1 1",
        "2: 2 2 2 2",
        "3: 2 2 3 3",
        "4: 2 2 2 4",
        "5: 2 2 3 4",
        "9: 2 2 3 4",
      ]
    `);
  });
});

describe("ProjectsSection", () => {
  it("keeps the projects past two rows out of reach until More opens them", () => {
    renderSection();
    expect(NAMES.map(isReachable)).toMatchInlineSnapshot(`
      [
        true,
        true,
        true,
        false,
        false,
        false,
      ]
    `);
    fireEvent.click(screen.getByRole("button", { name: "3 more" }));
    expect(NAMES.every(isReachable)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(isReachable("Travel")).toBe(false);
    expect(screen.getByRole("button", { name: "3 more" })).toBeTruthy();
  });

  it("shuts every project away while the section is folded", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(NAMES.some(isReachable)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(isReachable("Daily")).toBe(true);
  });
});
