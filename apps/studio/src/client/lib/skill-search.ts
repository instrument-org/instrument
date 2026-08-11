import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import uFuzzy from "@leeoniya/ufuzzy";

export interface SkillMatch<T> {
  descriptionRanges: null | number[];
  nameRanges: null | number[];
  skill: T;
}

/**
 * Move highlight ranges from the qualified name into the plain one, dropping
 * whatever matched inside the `source:` prefix. `offset` is that prefix's
 * length, and zero for the skills that never needed one.
 */
function rangesOverPlainName(
  ranges: null | number[],
  offset: number,
): null | number[] {
  if (!ranges || offset === 0) {
    return ranges;
  }
  const shifted: number[] = [];
  for (let index = 0; index < ranges.length; index += 2) {
    const start = Math.max((ranges[index] ?? 0) - offset, 0);
    const end = (ranges[index + 1] ?? 0) - offset;
    if (end > start) {
      shifted.push(start, end);
    }
  }
  return shifted.length > 0 ? shifted : null;
}

// One shared matcher for the prompt slash-menu and the skills page, so a query
// behaves the way search does everywhere else in the app and can show which
// characters it matched.
const fuzzy = new uFuzzy({ intraMode: 1 });

// Ranks skills against `query`, returning per-field highlight ranges. An empty
// query keeps the input order and highlights nothing. `limit` caps the result
// count when provided (the slash menu scrolls a bounded list); leave it off to
// keep every match.
//
// `scope` picks what the query is measured against, and every caller says which
// it wants because the two are not interchangeable.
//
// `name` is the literal text the slash menu offers: the plain name and nothing
// else. The two fields it leaves out both reach far past what was typed. A
// description is written to be long and to enumerate the phrases that should
// trigger a skill, so one ordinary word in one lands on skills that have nothing
// to do with it. The qualified ID carries a `source:` prefix, so typing the name
// of a source matches everything that came from it. Neither is on screen, and
// the menu's query is whatever the user has typed since the slash -- an absolute
// path as readily as a skill name.
//
// `name-and-description` is for the skills page, where the opposite holds:
// searching is browsing, description text is most of what there is to browse,
// and the source prefix is a useful way to ask for everything from one place.
// It matches the qualified ID, so a typed `claude:pdf` finds the skill it names.
//
// Either way `nameRanges` comes back in the coordinates of the plain name every
// caller displays.
export function matchSkills<
  T extends { description: string; id: string; name: string },
>(
  skills: T[],
  query: string,
  { limit, scope }: { limit?: number; scope: "name" | "name-and-description" },
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

  // What the query runs against in place of the plain name, and so what
  // `nameRanges` has to be shifted back from. They are the same string under
  // `name`, which makes that shift a no-op rather than a special case.
  const nameField = (skill: T) => (scope === "name" ? skill.name : skill.id);

  const fields = skills.map((skill) =>
    joinFuzzyFields(
      scope === "name"
        ? [nameField(skill)]
        : [nameField(skill), skill.description],
    ),
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
      const [qualifiedRanges, descriptionRanges] = field.splitRanges(
        info.ranges[orderIdx] ?? null,
      );
      return [
        {
          descriptionRanges: descriptionRanges ?? null,
          nameRanges: rangesOverPlainName(
            qualifiedRanges ?? null,
            nameField(skill).length - skill.name.length,
          ),
          skill,
        },
      ];
    }),
  );
}
