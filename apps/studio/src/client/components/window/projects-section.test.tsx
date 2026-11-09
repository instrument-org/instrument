// The projects over the inbox: the fold past four and the section's own
// fold, which stay drawn while closed so they can animate shut.
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type Project } from "./chats";
import { ProjectsSection } from "./projects-section";

const NAMES = ["Daily", "House", "Money", "Reading", "Taxes", "Travel"];

const PROJECTS: Project[] = NAMES.map((name, index) => ({
  color: "#0f9d6e",
  created: new Date(index),
  id: name.toLowerCase(),
  name,
}));

/** Whether the project's row can be reached: drawn and not shut away inert. */
function isReachable(name: string) {
  return screen.getByText(name).closest("[inert]") === null;
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

describe("ProjectsSection", () => {
  it("keeps the projects past four out of reach until More opens them", () => {
    renderSection();
    expect(NAMES.map(isReachable)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "2 more projects" }));
    expect(NAMES.every(isReachable)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(isReachable("Travel")).toBe(false);
  });

  it("shuts every project away while the section is folded", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(NAMES.some(isReachable)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(isReachable("Daily")).toBe(true);
  });
});
