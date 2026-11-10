import { describe, expect, it } from "vitest";

import {
  type ChangedProject,
  projectChangeLines,
  projectChangesHeading,
  projectLookBefore,
  projectLooks,
} from "./project-change-words";

const icon = (name: string): ChangedProject => ({
  fields: [{ after: "sun", before: null, field: "icon" }],
  name,
});
const color = (name: string): ChangedProject => ({
  fields: [{ after: "#765fca", before: "#d4bc79", field: "color" }],
  name,
});
const both = (name: string): ChangedProject => ({
  fields: [...icon(name).fields, ...color(name).fields],
  name,
});
const renamed: ChangedProject = {
  fields: [{ after: "Billing", before: "Invoices", field: "name" }],
  name: "Billing",
};
const deleted: ChangedProject = {
  fields: [{ after: true, before: false, field: "retired" }],
  name: "Events",
};

describe("projectChangesHeading", () => {
  it.each([
    ["icons and colors across projects", [icon("A"), color("B"), both("C")]],
    ["only icons", [icon("A"), icon("B")]],
    ["only colors", [color("A"), color("B"), color("C")]],
    ["one project's icon", [icon("Pricing")]],
    ["one project's icon and color", [both("Pricing")]],
    ["renames", [renamed, { ...renamed, name: "Ops" }]],
    ["one rename", [renamed]],
    ["deletes", [deleted, { ...deleted, name: "Old" }]],
    ["a mix", [renamed, deleted, color("Brand")]],
  ])("%s", (_, changes) => {
    expect(projectChangesHeading(changes)).toMatchSnapshot();
  });
});

describe("projectChangeLines", () => {
  it("says the look in one line, then a rename and a delete", () => {
    expect(
      projectChangeLines({
        fields: [...both("X").fields, ...renamed.fields, ...deleted.fields],
        name: "Billing",
      }),
    ).toEqual([
      { kind: "look", words: "Icon and color updated" },
      { after: "Billing", before: "Invoices", kind: "renamed" },
      { kind: "deleted", words: "Deleted" },
    ]);
  });

  it("says emoji for a project marked with one now", () => {
    expect(
      projectChangeLines({
        fields: [{ after: "🌵", before: null, field: "emoji" }],
        name: "Hard Times",
      }),
    ).toEqual([{ kind: "look", words: "Emoji updated" }]);
  });
});

describe("projectLookBefore", () => {
  it("puts back the emoji an icon replaced, and the old color", () => {
    expect(
      projectLookBefore({ color: "#765fca", icon: "cooking-pot" }, [
        { after: "cooking-pot", before: null, field: "icon" },
        { after: null, before: "🐭", field: "emoji" },
        { after: "#765fca", before: "#996d00", field: "color" },
      ]),
    ).toEqual({ color: "#996d00", emoji: "🐭" });
  });
});

describe("projectLooks", () => {
  const renamedAndColored: ChangedProject = {
    fields: [
      { after: "Houseplants", before: "Plants", field: "name" },
      { after: "#218b30", before: null, field: "color" },
    ],
    name: "Houseplants",
  };

  it("draws both sides from what was recorded, whatever the project is now", () => {
    expect(
      projectLooks(
        {
          ...renamedAndColored,
          project: {
            after: { color: "#218b30", name: "Houseplants" },
            before: { name: "Plants" },
            id: "prj_1",
          },
        },
        { name: "Plants" },
      ),
    ).toEqual({
      after: { color: "#218b30", name: "Houseplants" },
      before: { name: "Plants" },
    });
  });

  it("works back to the old name where only the fields were recorded", () => {
    expect(projectLooks(renamedAndColored, { color: "#218b30" })).toEqual({
      after: { color: "#218b30", name: "Houseplants" },
      before: { name: "Plants" },
    });
  });
});
