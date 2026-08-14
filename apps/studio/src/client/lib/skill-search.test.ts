import { describe, expect, it } from "vitest";

import { matchSkills } from "./skill-search";

const skills = [
  { description: "Ship a release", id: "workspace:release", name: "release" },
  { description: "Write a Word document", id: "instrument:docx", name: "docx" },
  {
    description: "Run the test suite",
    id: "claude:test",
    name: "test",
  },
  // Descriptions enumerate the phrases that should trigger a skill, so they
  // carry ordinary words that have nothing to do with the skill's name. This
  // one holds "project".
  {
    description:
      "Upgrade the video framework and its packages. Use when asked to update a video project.",
    id: "workspace:video-upgrade",
    name: "video-upgrade",
  },
];

describe("matchSkills", () => {
  it("keeps input order and highlights nothing for an empty query", () => {
    expect(matchSkills(skills, "", { scope: "name" })).toEqual(
      skills.map((skill) => ({
        descriptionRanges: null,
        nameRanges: null,
        skill,
      })),
    );
  });

  it("caps the result count at the limit", () => {
    expect(matchSkills(skills, "", { limit: 2, scope: "name" })).toHaveLength(
      2,
    );
  });

  it("returns nothing when the query matches no skill", () => {
    expect(matchSkills(skills, "zzzzz", { scope: "name" })).toEqual([]);
  });

  describe("name", () => {
    it("ranks by name and reports which characters matched", () => {
      const matches = matchSkills(skills, "release", { scope: "name" });
      expect(matches.map((match) => match.skill.id)).toEqual([
        "workspace:release",
      ]);
      expect(matches[0]?.nameRanges).not.toBeNull();
    });

    it("reports ranges over the plain name the caller displays", () => {
      const [match] = matchSkills(skills, "test", { scope: "name" });
      expect(match?.nameRanges).toEqual([0, 4]);
    });

    // The menu's query is whatever was typed after the slash, so an absolute
    // path reaches the matcher. Matching descriptions let a typed `/project`
    // select a skill whose description merely says "project", replacing what
    // the user wrote.
    it("ignores a word that appears only in a description", () => {
      expect(
        matchSkills(skills, "project", {
          scope: "name-and-description",
        }).map((match) => match.skill.id),
      ).toContain("workspace:video-upgrade");

      expect(matchSkills(skills, "project", { scope: "name" })).toEqual([]);
    });

    // The `source:` prefix is never on screen: the menu renders the plain name
    // and names the source in its own column.
    it.each(["claude", "instrument"])(
      "ignores the source prefix, so %s matches nothing",
      (source) => {
        expect(
          matchSkills(skills, source, { scope: "name-and-description" }).length,
        ).toBeGreaterThan(0);

        expect(matchSkills(skills, source, { scope: "name" })).toEqual([]);
      },
    );

    it("highlights nothing in a description it never searched", () => {
      const [match] = matchSkills(skills, "video", { scope: "name" });
      expect(match?.skill.id).toBe("workspace:video-upgrade");
      expect(match?.descriptionRanges).toBeNull();
    });
  });

  describe("name-and-description", () => {
    it("matches against the description, not only the name", () => {
      const matches = matchSkills(skills, "document", {
        scope: "name-and-description",
      });
      expect(matches.map((match) => match.skill.id)).toContain(
        "instrument:docx",
      );
    });

    it("reports which description characters matched", () => {
      const [match] = matchSkills(skills, "document", {
        scope: "name-and-description",
      });
      expect(match?.descriptionRanges).not.toBeNull();
    });

    it("matches a name typed with its source prefix", () => {
      const matches = matchSkills(skills, "claude:test", {
        scope: "name-and-description",
      });
      expect(matches.map((match) => match.skill.id)).toEqual(["claude:test"]);
    });

    it("shifts ranges off the source prefix onto the plain name", () => {
      const [match] = matchSkills(skills, "test", {
        scope: "name-and-description",
      });
      // "test" sits at 7 in "claude:test" and at 0 in what the menu renders.
      expect(match?.nameRanges).toEqual([0, 4]);
    });
  });
});
