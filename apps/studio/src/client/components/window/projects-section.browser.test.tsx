import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";

import { type Project } from "./chats";
import { ProjectsSection } from "./projects-section";

const NAMES = [
  "Daily",
  "House",
  "Money",
  "Reading",
  "Taxes",
  "Travel",
  "Garden",
  "Music",
  "Notes",
];

/** The tiles a section this wide lays out for so many projects, by the row each stands in. */
async function tilesAt(width: number, count: number) {
  const projects: Project[] = NAMES.slice(0, count).map((name, index) => ({
    color: "#0f9d6e",
    created: new Date(index),
    id: name.toLowerCase(),
    name,
  }));
  const shown = await renderInBrowser(
    <div style={{ width }}>
      <ProjectsSection
        chats={projects.map((project, index) => ({
          archived: false,
          lastUserMessageAt: count - index,
          project: project.id,
        }))}
        onChoose={() => undefined}
        onDetails={() => undefined}
        onNew={() => undefined}
        projects={projects}
      />
    </div>,
  );
  const section = shown.container.querySelector("section");
  if (!section) {
    throw new Error("No projects section");
  }
  // Every tile is a button that fills it, a project's or the More tile;
  // the heading's and the actions buttons are labeled or expand.
  const tiles = [
    ...section.querySelectorAll<HTMLElement>(
      "button:not([aria-label], [aria-expanded])",
    ),
  ].filter((tile) => tile.closest("[inert]") === null);
  const rows = new Map<number, string[]>();
  for (const tile of tiles) {
    const { top, width: wide } = tile.getBoundingClientRect();
    const name =
      tile.querySelector(".title-fade")?.textContent ?? tile.textContent;
    rows.set(top, [...(rows.get(top) ?? []), `${name} ${Math.round(wide)}`]);
  }
  await shown.unmount();
  return [...rows.values()].map((row) => row.join(" | "));
}

describe("the projects' tiles", () => {
  it("fill at most two rows of the columns the section's width has room for", async () => {
    const laidOut: Record<string, string[]> = {};
    for (const [width, count] of [
      [248, 3],
      [308, 1],
      [308, 3],
      [308, 4],
      [308, 9],
      [428, 9],
    ] as const) {
      laidOut[`${count} at ${width}px`] = await tilesAt(width, count);
    }
    expect(laidOut).toMatchInlineSnapshot(`
      {
        "1 at 308px": [
          "Daily 308",
        ],
        "3 at 248px": [
          "Daily 121 | House 121",
          "Money 121",
        ],
        "3 at 308px": [
          "Daily 99 | House 99 | Money 99",
        ],
        "4 at 308px": [
          "Daily 151 | House 151",
          "Money 151 | Reading 151",
        ],
        "9 at 308px": [
          "Daily 99 | House 99 | Money 99",
          "Reading 99 | Taxes 99 | 4 more 99",
        ],
        "9 at 428px": [
          "Daily 103 | House 103 | Money 103 | Reading 103",
          "Taxes 103 | Travel 103 | Garden 103 | 2 more 103",
        ],
      }
    `);
  });
});
