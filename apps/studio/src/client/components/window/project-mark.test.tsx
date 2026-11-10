import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectPill } from "./chat-row";
import { ProjectMark } from "./project-mark";

const project = {
  color: "#007fc3",
  created: new Date("2026-11-01T00:00:00Z"),
  emoji: "🐭",
  icon: "cooking-pot",
  id: "remy",
  name: "Remy",
};

describe("ProjectMark", () => {
  it("gives its icon a size- class, so a menu item's svg rule leaves it alone", () => {
    const { container } = render(<ProjectMark project={project} />);
    expect(container.querySelector("svg")?.getAttribute("class")).toMatch(
      /\bsize-\[62%\]/,
    );
  });
});

describe("ProjectPill", () => {
  it("shows the icon over the emoji when a project has both", () => {
    const { container } = render(<ProjectPill project={project} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toBe("Remy");
  });

  it("shows the emoji when the icon is not in this build's set", () => {
    const { container } = render(
      <ProjectPill project={{ ...project, icon: "no-such-icon" }} />,
    );
    expect(container.textContent).toBe("🐭Remy");
  });
});
