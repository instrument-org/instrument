import { listChildTasks } from "../../chat/children";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { searchTaskContent } from "../task-content-search";
import {
  TASK_LIST_WINDOW,
  type TaskSearchRow,
  renderTaskSearch,
  selectTasks,
} from "../task-list-output";
import { type TaskCommandContext } from "./context";
import { listQueryFrom, listRowsOf } from "./list";

/**
 * A task named for the term counts for about this many mentions of it.
 *
 * A conversation that said the word thirty times is what is being looked for,
 * so mentions lead the ordering. But a task whose title is the term is at
 * least as good an answer as one that mentioned it in passing, and ranking
 * purely on mentions would push it past the window and out of sight.
 */
const NAME_MATCH_MENTIONS = 5;

export const searchSubcommand = subcommand<TaskCommandContext>({
  booleans: ["all"],
  flags: ["limit", "since", "until"],
  run: runSearch,
  usage: `  ${TASK_COMMAND.name} search <words> [--since <date>] [--until <date>] [--limit <n>] [--all]
      Find a task by what was said in it. Searches every one of your tasks, not
      only the ones \`list\` last showed, and matches their titles and ids too.
      Each result carries how many times it came up and the words around the
      first mention, best match first. What a person or the agent said, not
      what a tool was handed or returned, so a page that happened to contain
      the word is not a match. Takes the same dates as \`list\`, which narrow
      what is opened before the search runs.
`,
});

async function runSearch(input: SubcommandInput, context: TaskCommandContext) {
  const term = input.positional.join(" ").trim();
  if (!term) {
    throw new Error("search needs words. `task search <words>`.");
  }
  const query = listQueryFrom(input);
  const children = await listChildTasks(context.chatId);
  // The dates narrow which conversations are opened at all; the window is
  // applied after ranking, so nothing is missed for having been old.
  const scoped = selectTasks(listRowsOf(children), {
    all: true,
    ...(query.since ? { since: query.since } : {}),
    ...(query.until ? { until: query.until } : {}),
  });
  const hits = await searchTaskContent({
    taskIds: scoped.shown.map((row) => row.id),
    term,
  });
  const wanted = term.toLowerCase();
  const matched: TaskSearchRow[] = scoped.shown.flatMap((row) => {
    const hit = hits.get(row.id);
    const named = `${row.title} ${row.id}`.toLowerCase().includes(wanted);
    if (!hit && !named) {
      return [];
    }
    return [{ ...row, count: hit?.count ?? 0, snippet: hit?.snippet ?? "" }];
  });
  const scoreOf = (row: TaskSearchRow) =>
    row.count +
    (`${row.title} ${row.id}`.toLowerCase().includes(wanted)
      ? NAME_MATCH_MENTIONS
      : 0);
  matched.sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) || b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const size = query.all ? matched.length : (query.limit ?? TASK_LIST_WINDOW);
  const shown = matched.slice(0, Math.max(0, size));
  if (shown.length === 0) {
    return `Nothing said "${term}", across ${scoped.total} ${scoped.total === 1 ? "task" : "tasks"}.\n`;
  }
  return renderTaskSearch({
    omitted: matched.length - shown.length,
    shown,
    total: matched.length,
  });
}
