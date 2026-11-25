/**
 * Does the chat tidy the user's bookmarks with `instrument bookmarks` when
 * asked to, and leave them alone when only asked about them?
 *
 * The stand-in window has a handful of bookmarks and answers the commands.
 * The score is the changes the turn's card shows, which is what the user
 * sees and can undo.
 *
 * - **tidy.** The three recipes go into a new folder on the bar and the one
 *   kept twice goes, with nothing else touched.
 * - **only-asked.** A question about them changes nothing.
 */
import { type BookmarkChange } from "../../src/schemas/bookmark-change";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";
import { type ListedBookmark } from "../lib/stand-in-window";
import { fail, pass } from "./handoff";

const bookmark = (id: string, title: string, url: string): ListedBookmark => ({
  id,
  kind: "bookmark",
  root: "all",
  title,
  url,
});

const RECIPES = ["a10c4e7b", "b27f0d31", "c5e8912a"];
const DUPLICATE = "d94b6f08";
const BOOKMARKS: ListedBookmark[] = [
  bookmark(
    "a10c4e7b-2f61-4c0e-9d55-0f6f0c5a7e11",
    "Roast cauliflower",
    "https://recipes.example/roast-cauliflower",
  ),
  bookmark(
    "e03d7a55-64b1-4f3a-8a53-1f0d9b2f7c22",
    "Library hours",
    "https://library.example/hours",
  ),
  bookmark(
    "b27f0d31-90ce-4d27-b1b4-3a5b8e6c1d33",
    "Weeknight dal",
    "https://recipes.example/weeknight-dal",
  ),
  bookmark(
    "f61a2c9d-7d48-4b7c-a0e6-5c2e7f4a9b44",
    "Bus times",
    "https://transit.example/route-12",
  ),
  bookmark(
    "c5e8912a-1b3f-4a68-92d7-7e4f6a0b8c55",
    "Lemon olive oil cake",
    "https://recipes.example/olive-oil-cake",
  ),
  bookmark(
    "d94b6f08-5c2d-4e91-8f3a-9b6a1c7d0e66",
    "Bus times (copy)",
    "https://transit.example/route-12?ref=home",
  ),
];

/** Every change the turns' cards show. */
function changesIn(sessions: Session.WithMessagesAndParts[]): BookmarkChange[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "data-bookmarkChanges" ? part.data.changes : [],
      ),
    ),
  );
}

const short = (change: BookmarkChange) => change.id.slice(0, 8);

const filedTheRecipes: Assertion = {
  check: ({ sessions }) => {
    const text = "filed the recipes in a Recipes folder on the bar";
    const changes = changesIn(sessions);
    const folder = changes.find(
      ({ after, before }) =>
        !before &&
        after?.kind === "folder" &&
        after.root === "bar" &&
        /^recipes$/i.test(after.title),
    );
    const filed = changes
      .filter(({ after }) => folder && after?.folder === folder.id)
      .map(short)
      .toSorted();
    const evidence = JSON.stringify({ filed, folder: folder?.after?.title });
    return filed.join() === RECIPES.toSorted().join()
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "filed the recipes in a Recipes folder on the bar",
};

const removedOnlyTheDuplicate: Assertion = {
  check: ({ sessions }) => {
    const text = "removed the duplicate and nothing else";
    const removed = changesIn(sessions)
      .filter(({ after }) => !after)
      .map(short);
    return removed.join() === DUPLICATE
      ? pass(text, removed.join())
      : fail(text, removed.join() || "removed nothing");
  },
  text: "removed the duplicate and nothing else",
};

const changedNothing: Assertion = {
  check: ({ sessions }) => {
    const text = "changed no bookmark";
    const changed = changesIn(sessions).map(short);
    return changed.length === 0
      ? pass(text, "no changes")
      : fail(text, changed.join(", "));
  },
  text: "changed no bookmark",
};

export const BOOKMARKS_EVALS = [
  defineEval({
    assertions: [filedTheRecipes, removedOnlyTheDuplicate],
    bookmarks: BOOKMARKS,
    kind: "chat",
    name: "bookmarks-tidy",
    prompt:
      'Put my recipe bookmarks in a Recipes folder on the bookmarks bar, and get rid of "Bus times (copy)", I have it twice.',
  }),
  defineEval({
    assertions: [changedNothing],
    bookmarks: BOOKMARKS,
    kind: "chat",
    name: "bookmarks-only-asked",
    prompt: "Which of my bookmarks are recipes? Are any in there twice?",
  }),
];
