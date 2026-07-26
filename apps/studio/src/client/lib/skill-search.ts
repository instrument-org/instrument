import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import uFuzzy from "@leeoniya/ufuzzy";

export interface SkillMatch<T> {
  descriptionRanges: null | number[];
  nameRanges: null | number[];
  skill: T;
}

// One shared matcher for the prompt slash-menu and the skills page, so a query
// behaves the way search does everywhere else in the app and can show which
// characters it matched.
const fuzzy = new uFuzzy({ intraMode: 1 });

// Ranks skills against `query` across name + description, returning per-field
// highlight ranges. An empty query keeps the input order and highlights
// nothing. `limit` caps the result count when provided (the slash menu scrolls
// a bounded list); leave it off to keep every match.
export function matchSkills<
  T extends { description: string; qualifiedName: string },
>(
  skills: T[],
  query: string,
  limit?: number,
): SkillMatch<T>[] {
  const cap = (matches: SkillMatch<T>[]) =>
    limit === undefined ? matches : matches.slice(0, limit);

  if (!query) {
    return cap(
      skills.map((skill) => ({
        descriptionRanges: null,
        nameRanges: null,
        skill,
      })),
    );
  }

  const fields = skills.map((skill) =>
    joinFuzzyFields([skill.qualifiedName, skill.description]),
  );
  const haystack = fields.map((field) => field.haystack);
  // eslint-disable-next-line unicorn/no-array-method-this-argument
  const indexes = fuzzy.filter(haystack, query);
  if (!indexes || indexes.length === 0) {
    return [];
  }

  const info = fuzzy.info(indexes, haystack, query);
  const order = fuzzy.sort(info, haystack, query);

  return cap(
    order.flatMap((orderIdx) => {
      const index = info.idx[orderIdx] ?? -1;
      const skill = skills[index];
      const field = fields[index];
      if (!skill || !field) {
        return [];
      }
      const [nameRanges, descriptionRanges] = field.splitRanges(
        info.ranges[orderIdx] ?? null,
      );
      return [
        {
          descriptionRanges: descriptionRanges ?? null,
          nameRanges: nameRanges ?? null,
          skill,
        },
      ];
    }),
  );
}
