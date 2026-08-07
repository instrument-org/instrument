import {
  batch,
  pause,
  prose,
  reasoning,
  sameStep,
  type Scenario,
  stop,
  user,
} from "./script";
import {
  activity,
  edited,
  ran,
  ranAndFailed,
  read,
  readMissing,
  searched,
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
 * The transcripts worth watching play out.
 *
 * One of them is the whole thing end to end, and it is the one to reach for:
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
    script: [
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
      "Shapes no well-behaved transcript reaches: a heading the model left blank, two headings in a row, and calls before any heading at all.",
    id: "edge-cases",
    name: "Edge cases",
    script: [
      user("Have a look at the folder."),
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
      "A written answer arriving a few words at a time, over enough frames to watch the text itself rather than the transcript around it. Nothing else happens in it: play it to judge how prose, headings and lists read while they are still growing.",
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
];
