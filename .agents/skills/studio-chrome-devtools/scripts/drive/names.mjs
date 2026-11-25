// Matching a name a script wrote against the names the app gives its
// controls. Pure, so it is tested without an instance (names.test.mjs).
//
// A script names a control the way a person reads it: "Print", "Search", "New
// tab". The app's accessible names carry more: a shortcut ("Search ⌘K"), an
// ellipsis ("Print…"), a role word ("Budget tab group"). So a name is tried in
// tiers, from exact to loose, and the first tier with a match decides: an
// exact match is never ambiguous with a looser one, and a loose name that
// matches two things says which two.

/** Shortcut glyphs and key names a label carries after its words. */
const SHORTCUT =
  /\s+(?:(?:[⌘⌥⇧⌃]+|(?:cmd|ctrl|alt|shift|meta|option)\+)+\s*\S{1,6}|alt\+\S)$/i;

/** Folds case, spacing, ellipses and the shortcut a label ends with. */
export function fold(name) {
  return String(name ?? "")
    .normalize("NFKC")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(SHORTCUT, "")
    .replace(/(?:…|\.\.\.)$/, "")
    .trim()
    .toLowerCase();
}

/**
 * How closely `name` fits `wanted`, as a tier: 0 exact, 1 equal once folded,
 * 2 starts with it at a word boundary, 3 contains it at a word boundary, 4
 * contains it anywhere. Undefined when it does not fit at all. A RegExp fits
 * at tier 0 when it matches.
 */
export function tierOf(name, wanted) {
  if (wanted instanceof RegExp) {
    return wanted.test(String(name ?? "")) ? 0 : undefined;
  }
  const raw = String(name ?? "").trim();
  if (raw === String(wanted).trim()) {
    return 0;
  }
  const have = fold(raw);
  const want = fold(wanted);
  if (!want || !have) {
    return undefined;
  }
  if (have === want) {
    return 1;
  }
  const at = have.indexOf(want);
  if (at === -1) {
    return undefined;
  }
  const before = at === 0 ? " " : have[at - 1];
  const after = have[at + want.length] ?? " ";
  const isWord = !/\w/.test(before) && !/\w/.test(after);
  if (at === 0 && isWord) {
    return 2;
  }
  return isWord ? 3 : 4;
}

/**
 * The candidates `wanted` names: those at the best tier any of them reaches.
 * `nameOf` reads a candidate's name. An empty list means none fit.
 */
export function bestMatches(candidates, wanted, nameOf = (each) => each.name) {
  if (wanted === undefined) {
    return candidates;
  }
  let best = Infinity;
  let found = [];
  for (const candidate of candidates) {
    const tier = tierOf(nameOf(candidate), wanted);
    if (tier === undefined || tier > best) {
      continue;
    }
    if (tier < best) {
      best = tier;
      found = [];
    }
    found.push(candidate);
  }
  return found;
}

/**
 * Edit distance counting a swap of two neighbors as one edit, for the names
 * a missed one was probably meant to be ("Sned" is one from "Send").
 */
function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

/** The names nearest to `wanted`, closest first, for a failure to offer. */
export function nearest(names, wanted, count = 5) {
  const want = fold(wanted instanceof RegExp ? wanted.source : wanted);
  const seen = new Set();
  return names
    .filter((name) => {
      const key = fold(name);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((name) => {
      const have = fold(name);
      const shared = have.includes(want) || want.includes(have) ? 0.5 : 1;
      return {
        name,
        score:
          (distance(have, want) / Math.max(have.length, want.length, 1)) *
          shared,
      };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, count)
    .map(({ name }) => name);
}

/** A name as a failure quotes it. */
export function quote(wanted) {
  return wanted instanceof RegExp ? String(wanted) : JSON.stringify(wanted);
}
