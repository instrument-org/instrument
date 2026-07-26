import { describe, expect, it } from "vitest";

import { matchSkills } from "./skill-search";

const skills = [
  { description: "Ship a release", name: "release", qualifiedName: "release" },
  { description: "Write a Word document", name: "docx", qualifiedName: "docx" },
  {
    description: "Run the test suite",
    name: "test",
    qualifiedName: "claude:test",
  },
];

describe("matchSkills", () => {
  it("keeps input order and highlights nothing for an empty query", () => {
    expect(matchSkills(skills, "")).toEqual(
      skills.map((skill) => ({
        descriptionRanges: null,
        nameRanges: null,
        skill,
      })),
    );
  });

  it("caps the result count at the limit", () => {
    expect(matchSkills(skills, "", 2)).toHaveLength(2);
  });

  it("ranks by name and reports which characters matched", () => {
    const matches = matchSkills(skills, "release");
    expect(matches.map((match) => match.skill.qualifiedName)).toEqual([
      "release",
    ]);
    expect(matches[0]?.nameRanges).not.toBeNull();
  });

  it("matches against the description, not only the name", () => {
    const matches = matchSkills(skills, "document");
    expect(matches.map((match) => match.skill.qualifiedName)).toContain("docx");
  });

  it("matches a name typed with its source prefix", () => {
    const matches = matchSkills(skills, "claude:test");
    expect(matches.map((match) => match.skill.qualifiedName)).toEqual([
      "claude:test",
    ]);
  });

  it("reports ranges over the plain name the caller displays", () => {
    const [match] = matchSkills(skills, "test");
    // "test" sits at 7 in "claude:test" and at 0 in what the menu renders.
    expect(match?.nameRanges).toEqual([0, 4]);
  });

  it("returns nothing when the query matches no skill", () => {
    expect(matchSkills(skills, "zzzzz")).toEqual([]);
  });
});
