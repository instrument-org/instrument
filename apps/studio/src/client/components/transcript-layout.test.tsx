import {
  ProjectIdSchema,
  type SessionMessage,
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  buildTranscriptLayout,
  generatedGroupHeading,
  groupCanExpand,
  groupStandInRowId,
  planRow,
  type TranscriptGroup,
} from "./transcript-layout";

const sessionId = StoreId.newSessionId();

interface BuildOptions {
  isAgentRunning?: boolean;
  isDeveloperMode?: boolean;
}

/**
 * One part, written as `[kind, label]`. The label is both the part's contents
 * and the name the diagram reads it back under.
 */
type Spec = [
  (
    | "activity"
    | "bash"
    | "note"
    | "prose"
    | "queued"
    | "read"
    | "rollover"
    | "running"
    | "search"
    | "thinking"
    | "thought"
    | "untitled-activity"
  ),
  string,
];

type Turns = { role: "assistant" | "user"; specs: Spec[] }[];

/** Each row's wide boundary, read back under the label the spec gave it. */
function boundaries(turns: Turns): Map<string, boolean> {
  const { labels, layout } = build(turns);
  return new Map(
    [...layout.rows.values()].map((row) => [
      labels.get(row.id) ?? row.id,
      row.hasProseBoundaryAbove === true,
    ]),
  );
}

/**
 * The transcript as the layout would draw it.
 *
 * A group opens with a rule naming its kind, its phase, and the heading it
 * generated, if any; a declared group's heading is a row of its own and shows
 * up in the list like anything else. Every row is on a line, `·` where the fold
 * has taken it out and indented where it sits under a head line, and `>` marks
 * the copy of the step in flight that a working group draws in place of what it
 * holds. A `~` is the wide boundary between what the agent said and what it did.
 * So a case reads as the shape it produces, and a change to any of the rules
 * shows up as a change to the picture.
 */
function build(
  turns: Turns,
  { isAgentRunning = false, isDeveloperMode = false }: BuildOptions = {},
) {
  const built = turns.map((turn) => buildMessage(turn.role, turn.specs));
  const labels = new Map(built.flatMap(({ labels: l }) => [...l]));
  const lastMessageId = built.at(-1)?.message.id;
  const layout = buildTranscriptLayout({
    isAgentRunning,
    isDeveloperMode,
    // Matches the rule the stream itself applies: only the tail message of a
    // running agent has calls in flight.
    isToolStreaming: (_part, message) =>
      isAgentRunning && message.id === lastMessageId,
    regularMessages: built.map(({ message }) => message),
  });
  return { labels, layout };
}

function buildMessage(
  role: "assistant" | "user",
  specs: Spec[],
): { labels: Map<string, string>; message: SessionMessage.WithParts } {
  const messageId = StoreId.newMessageId();
  const labels = new Map<string, string>();
  const parts = specs.map(([kind, label]) => {
    const metadata = {
      createdAt: new Date(0),
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    };
    labels.set(metadata.id, label);
    const toolCallId = StoreId.ToolCallSchema.parse(`call-${label}`);
    const done = { metadata, state: "output-available", toolCallId };

    switch (kind) {
      case "activity":
      case "untitled-activity": {
        return {
          ...done,
          input: kind === "activity" ? { title: label } : {},
          output: {},
          type: "tool-start_activity",
        };
      }
      case "bash": {
        return {
          ...done,
          input: { command: label },
          output: {},
          type: "tool-bash",
        };
      }
      // Something the run attached to the turn rather than something the agent
      // did or said. It draws a card of its own and is never a step.
      case "note": {
        return {
          data: {
            foldersAdded: [],
            foldersRemoved: [],
            instructionsChanged: false,
            projectId: ProjectIdSchema.parse("prj_01234567890123456789012345"),
            projectName: label,
          },
          metadata,
          type: "data-projectChanges",
        };
      }
      case "prose": {
        return { metadata, state: "done", text: label, type: "text" };
      }
      // Asked for by the model and waiting behind whatever is ahead of it.
      case "queued": {
        return {
          input: { filePath: label },
          metadata,
          state: "input-available",
          toolCallId,
          type: "tool-read_file",
        };
      }
      case "read": {
        return {
          ...done,
          input: { filePath: label },
          output: { state: "does-not-exist" },
          type: "tool-read_file",
        };
      }
      case "rollover": {
        return {
          data: { droppedMessages: 4, retainedUserMessages: 4 },
          metadata,
          type: "data-contextRollover",
        };
      }
      // Picked up off the queue: started, with nothing written back yet.
      case "running": {
        return {
          input: { filePath: label },
          metadata: { ...metadata, startedAt: new Date(1) },
          state: "input-available",
          toolCallId,
          type: "tool-read_file",
        };
      }
      case "search": {
        return {
          ...done,
          input: { query: label },
          output: { results: [], state: "success" },
          type: "tool-web_search",
        };
      }
      case "thinking": {
        return { metadata, state: "streaming", text: label, type: "reasoning" };
      }
      case "thought": {
        return { metadata, state: "done", text: label, type: "reasoning" };
      }
    }
  }) as SessionMessagePart.Type[];

  return {
    labels,
    message: {
      id: messageId,
      metadata: { createdAt: new Date(0), sessionId },
      parts,
      role,
    } as SessionMessage.WithParts,
  };
}

function draw(
  turns: Turns,
  {
    isExpanded = false,
    ...options
  }: BuildOptions & { isExpanded?: boolean } = {},
): string {
  const { labels, layout } = build(turns, options);

  const lines: string[] = [];
  let openGroupId: string | undefined;

  const standIn = (group: TranscriptGroup) => {
    const rowId = groupStandInRowId({ group, isExpanded });
    if (rowId === undefined) {
      return;
    }
    const indent = group.headingRowId === undefined ? "" : "  ";
    lines.push(`> ${indent}${labels.get(rowId) ?? rowId}`);
  };

  for (const [rowId, row] of layout.rows) {
    const group =
      row.groupId === undefined ? undefined : layout.groups.get(row.groupId);
    // Where what the agent said meets what it did, which the transcript opens
    // wider than the rows around it.
    if (row.hasProseBoundaryAbove) {
      lines.push("~");
    }
    if (row.groupId !== openGroupId) {
      openGroupId = row.groupId;
      if (group) {
        const heading = generatedGroupHeading(group);
        lines.push(
          [
            "---",
            group.headingRowId === undefined ? "inferred" : "declared",
            group.phase,
            heading === undefined ? "" : `"${heading}"`,
          ]
            .filter(Boolean)
            .join(" "),
        );
        // With no heading of its own, the copy is the group's head line.
        if (group.headingRowId === undefined) {
          standIn(group);
        }
      }
    }
    const { isHidden, isIndented } = planRow({ group, isExpanded, row });
    lines.push(
      `${isHidden ? "·" : " "} ${isIndented ? "  " : ""}${labels.get(rowId) ?? rowId}`,
    );
    // A declared group draws it under the heading, which is the one row of the
    // group that is on screen for the whole of its life.
    if (group?.headingRowId === rowId) {
      standIn(group);
    }
  }

  return lines.join("\n");
}

/**
 * Each group's tally of what it holds, which is what a renderer working one
 * message at a time has to decide from rather than from the rows in front of
 * it.
 */
function groupSpans(turns: Turns): string[] {
  const { labels, layout } = build(turns);
  return [...layout.groups.values()].map((group) =>
    [
      group.headingRowId === undefined ? "inferred" : "declared",
      `folds=${group.foldedRowCount}`,
      `opensOn="${labels.get(group.id) ?? group.id}"`,
      `canExpand=${groupCanExpand(group) ? "true" : "false"}`,
    ].join(" "),
  );
}

describe("groups the agent named", () => {
  it("folds its steps behind the heading and hands over to the next one", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["activity", "Finding the notes"],
            ["read", "one"],
            ["thought", "weighing it up"],
            ["activity", "Writing the brief"],
            ["bash", "make brief"],
            ["prose", "here is the brief"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- declared settled
        Finding the notes
      ·   one
      ·   weighing it up
      --- declared settled
        Writing the brief
      ·   make brief
      ~
        here is the brief"
    `);
  });

  // The agent stopping to say something ends the phase, named or not. What it
  // does next is a phase of its own, which the transcript has to generate a
  // name for even though the agent already gave it one for the work above.
  it("ends the phase where the agent stops to say something", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["activity", "Finding the notes"],
            ["read", "one"],
            ["prose", "these are older than I expected"],
            ["read", "two"],
            ["read", "three"],
            ["prose", "here is the brief"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- declared settled
        Finding the notes
      ·   one
      ~
        these are older than I expected
      ~
      --- inferred settled "Read 2 files"
      ·   two
      ·   three
      ~
        here is the brief"
    `);
  });

  // Nothing the fold does can reach what the agent said, so nothing that lands
  // after a paragraph can pull it out of view either -- a project change, a file
  // the watcher saw, whatever developer mode is drawing this week.
  it("leaves what the agent said outside every phase, notes and all", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["activity", "Finding the notes"],
            ["read", "one"],
            ["prose", "here is the brief"],
            ["note", "Quarterly reports"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- declared settled
        Finding the notes
      ·   one
      ~
        here is the brief
        Quarterly reports"
    `);
  });

  // Every turn keeps its answer, not just the one at the bottom. The rule is
  // read per turn as the transcript is walked, so sending another message does
  // not fold away what the last one was told.
  it("keeps the answer of a turn the conversation has moved past", () => {
    expect(
      draw([
        { role: "user", specs: [["prose", "find the notes"]] },
        {
          role: "assistant",
          specs: [
            ["activity", "Finding the notes"],
            ["read", "one"],
            ["prose", "here is the brief"],
          ],
        },
        { role: "user", specs: [["prose", "now chart it"]] },
        {
          role: "assistant",
          specs: [
            ["activity", "Charting it"],
            ["read", "two"],
            ["prose", "here is the chart"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "  find the notes
      --- declared settled
        Finding the notes
      ·   one
      ~
        here is the brief
        now chart it
      --- declared settled
        Charting it
      ·   two
      ~
        here is the chart"
    `);
  });

  it("shows every step once the reader opens it", () => {
    expect(
      draw(
        [
          {
            role: "assistant",
            specs: [
              ["activity", "Finding the notes"],
              ["read", "one"],
              ["read", "two"],
            ],
          },
        ],
        { isExpanded: true },
      ),
    ).toMatchInlineSnapshot(`
      "--- declared settled
        Finding the notes
          one
          two"
    `);
  });

  // A phase boundary the model left unnamed is still a phase boundary. The row
  // draws nothing, so it has to be read before it is a row at all: filtered out
  // for having nothing to say, it is invisible twice over and the calls after
  // it go on joining the phase it was ending.
  it("ends the open phase on a heading the model left blank", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["activity", "Finding the notes"],
            ["read", "one"],
            ["untitled-activity", ""],
            ["read", "two"],
            ["read", "three"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- declared settled
        Finding the notes
      ·   one
      --- inferred settled "Read 2 files"
      ·   two
      ·   three"
    `);
  });

  // The named phase is over, so the call that follows the paragraph starts a run
  // of its own rather than joining it. That is what keeps the copy of the step
  // in flight above whatever the agent has said: a phase carried on across the
  // paragraph would draw its next step underneath it and then jump back up.
  it("starts a new run after the note, rather than reopening the phase", () => {
    expect(
      draw(
        [
          {
            role: "assistant",
            specs: [
              ["activity", "Finding the notes"],
              ["read", "one"],
              ["prose", "these are older than I expected"],
            ],
          },
          { role: "assistant", specs: [["running", "two"]] },
        ],
        { isAgentRunning: true },
      ),
    ).toMatchInlineSnapshot(`
      "--- declared settled
        Finding the notes
      ·   one
      ~
        these are older than I expected
      ~
      --- inferred working
      > two
      ·   two"
    `);
  });

  // Not even as a folded row: a call that draws nothing is not a row, and one
  // that is leaves an empty box behind for as long as the title takes to
  // arrive, which is every time an activity opens.
  it("leaves a heading with no title out of the transcript entirely", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["untitled-activity", "still streaming"],
            ["read", "one"],
            ["read", "two"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- inferred settled "Read 2 files"
      ·   one
      ·   two"
    `);
  });
});

// Developer mode throughout: the part is classified "dev", so it is filtered
// out of the layout entirely for everyone else.
describe("the context rollover boundary", () => {
  // Recorded against whatever message was newest when assembly ran, which
  // mid-run is an assistant step with a phase already open around it. As an
  // ordinary data note it folded into that phase and read as one more step the
  // agent took, rather than as the place the request was cut.
  it("ends the phase it lands in rather than joining it", () => {
    const turns: Turns = [
      { role: "user", specs: [["prose", "count to forty"]] },
      { role: "assistant", specs: [["bash", "write the notes"]] },
      { role: "assistant", specs: [["rollover", "boundary"]] },
      { role: "assistant", specs: [["prose", "1. one"]] },
    ];

    expect(draw(turns, { isDeveloperMode: true })).toMatchInlineSnapshot(`
      "  count to forty
      --- inferred settled
        write the notes
        boundary
        1. one"
    `);
  });

  // The same shape with an ordinary note in the boundary's place, which is what
  // the rollover was before it settled the phase: the note is swallowed by the
  // group and folded out of sight, and the reply after it lands inside the run
  // rather than after it.
  it("is not what an ordinary note in that position does", () => {
    const turns: Turns = [
      { role: "user", specs: [["prose", "count to forty"]] },
      { role: "assistant", specs: [["bash", "write the notes"]] },
      { role: "assistant", specs: [["note", "boundary"]] },
      { role: "assistant", specs: [["prose", "1. one"]] },
    ];

    expect(draw(turns, { isDeveloperMode: true })).toMatchInlineSnapshot(`
      "  count to forty
      --- inferred settled
      > write the notes
      ·   write the notes
      ·   boundary
      ~
        1. one"
    `);
  });
});

describe("groups that span messages", () => {
  // The shape of a real turn: the agent emits a message per step, so a group of
  // any size reaches across several of them and is only whole when read across
  // the transcript rather than one message at a time.
  it("holds a group together across the messages a turn is made of", () => {
    const turns: Turns = [
      { role: "user", specs: [["prose", "pull the product images"]] },
      { role: "assistant", specs: [["thought", "which page"]] },
      { role: "assistant", specs: [["activity", "Inspecting the gallery"]] },
      { role: "assistant", specs: [["bash", "open the page"]] },
      { role: "assistant", specs: [["bash", "convert them"]] },
      { role: "assistant", specs: [["prose", "here are the files"]] },
    ];

    expect(draw(turns)).toMatchInlineSnapshot(`
      "  pull the product images
      --- inferred settled
        which page
      --- declared settled
        Inspecting the gallery
      ·   open the page
      ·   convert them
      ~
        here are the files"
    `);
    expect(groupSpans(turns)).toMatchInlineSnapshot(`
      [
        "inferred folds=1 opensOn="which page" canExpand=false",
        "declared folds=2 opensOn="Inspecting the gallery" canExpand=true",
      ]
    `);
  });
});

describe("groups the agent never named", () => {
  it("folds an unannounced run behind a heading built from what it did", () => {
    expect(
      draw([
        { role: "user", specs: [["prose", "chart the numbers"]] },
        {
          role: "assistant",
          specs: [
            ["read", "sales.csv"],
            ["read", "costs.csv"],
            ["bash", "python chart.py"],
            ["search", "chart legends"],
            ["prose", "here is the chart"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "  chart the numbers
      --- inferred settled "Read 2 files, ran a command and searched the web"
      ·   sales.csv
      ·   costs.csv
      ·   python chart.py
      ·   chart legends
      ~
        here is the chart"
    `);
  });

  it("breaks at prose, so each stretch between replies is its own run", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["read", "one"],
            ["read", "two"],
            ["prose", "found them"],
            ["bash", "wc -l"],
            ["bash", "sort"],
            ["prose", "and here is the count"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- inferred settled "Read 2 files"
      ·   one
      ·   two
      ~
        found them
      ~
      --- inferred settled "Ran 2 commands"
      ·   wc -l
      ·   sort
      ~
        and here is the count"
    `);
  });

  // A phrase built from one call would say less than the call's own row does,
  // which is why a generated heading needs two. The run around it is another
  // matter: the agent thinks before it acts, so the fold is trading three rows
  // for one rather than one for one, and the call heads its own run.
  it("folds a run around a lone call under the call itself", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["thought", "which file"],
            ["read", "sales.csv"],
            ["prose", "here it is"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- inferred settled
      > sales.csv
      ·   which file
      ·   sales.csv
      ~
        here it is"
    `);
  });

  // The shape almost every turn with one call really has: the agent reasons,
  // calls, reasons about what came back, then answers.
  it("folds a call with reasoning on both sides of it", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["thought", "what to draw"],
            ["read", "cat.png"],
            ["thought", "that worked"],
            ["prose", "here is the cat"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- inferred settled
      > cat.png
      ·   what to draw
      ·   cat.png
      ·   that worked
      ~
        here is the cat"
    `);
  });

  // Nothing to fold: the run is already the one line it would fold to, and a
  // copy of the only row is not a head line, it is the row again.
  it("leaves a call standing alone as its own row", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["read", "sales.csv"],
            ["prose", "here it is"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- inferred settled
        sales.csv
      ~
        here it is"
    `);
  });

  it("shows what the run held once the reader opens it", () => {
    expect(
      draw(
        [
          {
            role: "assistant",
            specs: [
              ["thought", "what to draw"],
              ["read", "cat.png"],
              ["thought", "that worked"],
            ],
          },
        ],
        { isExpanded: true },
      ),
    ).toMatchInlineSnapshot(`
      "--- inferred settled
      > cat.png
          what to draw
          cat.png
          that worked"
    `);
  });
});

describe("while the agent is working", () => {
  it("heads an unannounced run with a copy of the call the queue reached", () => {
    expect(
      draw(
        [
          {
            role: "assistant",
            specs: [
              ["read", "one"],
              ["running", "two"],
              ["queued", "three"],
            ],
          },
        ],
        { isAgentRunning: true },
      ),
    ).toMatchInlineSnapshot(`
      "--- inferred working
      > two
      ·   one
      ·   two"
    `);
  });

  it("shows the queue in developer mode, where watching it drain is the point", () => {
    expect(
      draw(
        [
          {
            role: "assistant",
            specs: [
              ["running", "two"],
              ["queued", "three"],
            ],
          },
        ],
        { isAgentRunning: true, isDeveloperMode: true, isExpanded: true },
      ),
    ).toMatchInlineSnapshot(`
      "--- inferred working
      > two
          two
          three"
    `);
  });

  it("keeps the heading and puts the row in flight under it", () => {
    expect(
      draw(
        [
          {
            role: "assistant",
            specs: [
              ["activity", "Finding the notes"],
              ["read", "one"],
              ["running", "two"],
            ],
          },
        ],
        { isAgentRunning: true },
      ),
    ).toMatchInlineSnapshot(`
      "--- declared working
        Finding the notes
      >   two
      ·   one
      ·   two"
    `);
  });

  it("keeps the last step under the heading when nothing is in flight", () => {
    expect(
      draw(
        [
          {
            role: "assistant",
            specs: [
              ["activity", "Finding the notes"],
              ["read", "one"],
            ],
          },
        ],
        { isAgentRunning: true },
      ),
    ).toMatchInlineSnapshot(`
      "--- declared working
        Finding the notes
      >   one
      ·   one"
    `);
  });

  it("takes streaming reasoning as the row in flight", () => {
    expect(
      draw(
        [
          {
            role: "assistant",
            specs: [
              ["read", "one"],
              ["thinking", "weighing it up"],
            ],
          },
        ],
        { isAgentRunning: true },
      ),
    ).toMatchInlineSnapshot(`
      "--- inferred working
      > weighing it up
      ·   one
      ·   weighing it up"
    `);
  });

  it("settles the moment the agent stops, whatever the parts still say", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["read", "one"],
            ["read", "two"],
            ["thinking", "cut off"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- inferred settled "Read 2 files"
      ·   one
      ·   two
      ·   cut off"
    `);
  });

  it("ends the group at the turn, which the agent never closed", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["activity", "Finding the notes"],
            ["read", "one"],
          ],
        },
        { role: "user", specs: [["prose", "and now this"]] },
        { role: "assistant", specs: [["read", "two"]] },
      ]),
    ).toMatchInlineSnapshot(`
      "--- declared settled
        Finding the notes
      ·   one
        and now this
      --- inferred settled
        two"
    `);
  });
});

// 24px where what the agent said meets what it did, against the 8px everything
// else in the transcript sits on. Runs of steps stay 8px from each other: the
// boundary is prose, not every edge a group has.
describe("the space around what the agent said", () => {
  it("opens either side of a paragraph the agent wrote mid-turn", () => {
    expect(
      draw([
        { role: "user", specs: [["prose", "find the notes"]] },
        {
          role: "assistant",
          specs: [
            ["read", "one"],
            ["read", "two"],
            ["prose", "these are older than I expected"],
            ["read", "three"],
            ["read", "four"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "  find the notes
      --- inferred settled "Read 2 files"
      ·   one
      ·   two
      ~
        these are older than I expected
      ~
      --- inferred settled "Read 2 files"
      ·   three
      ·   four"
    `);
  });

  it("leaves one phase against the next on the transcript's own rhythm", () => {
    expect(
      draw([
        {
          role: "assistant",
          specs: [
            ["activity", "Finding the notes"],
            ["read", "one"],
            ["activity", "Writing the brief"],
            ["bash", "make brief"],
          ],
        },
      ]),
    ).toMatchInlineSnapshot(`
      "--- declared settled
        Finding the notes
      ·   one
      --- declared settled
        Writing the brief
      ·   make brief"
    `);
  });

  // The first row of a turn is under the wordmark, which spaces it already.
  it("leaves the top of a turn alone", () => {
    expect(
      draw([
        { role: "user", specs: [["prose", "find the notes"]] },
        { role: "assistant", specs: [["read", "one"]] },
      ]),
    ).toMatchInlineSnapshot(`
      "  find the notes
      --- inferred settled
        one"
    `);
  });

  // The one property that keeps this from moving the transcript. A row's
  // spacing is read from the row above it, which is settled the moment the row
  // exists; read the other way, a step arriving after a paragraph would grow
  // that paragraph 16px taller and lift everything above it.
  it("settles a row's spacing when the row arrives, and never after", () => {
    const specs: Spec[] = [
      ["activity", "Finding the notes"],
      ["read", "one"],
      ["thought", "weighing it up"],
      ["prose", "these are older than I expected"],
      ["read", "two"],
      ["read", "three"],
      ["prose", "here is the brief"],
      ["note", "Quarterly reports"],
    ];

    let previous = new Map<string, boolean>();
    for (let count = 1; count <= specs.length; count++) {
      const current = boundaries([
        { role: "user", specs: [["prose", "find the notes"]] },
        { role: "assistant", specs: specs.slice(0, count) },
      ]);
      for (const [label, hadBoundary] of previous) {
        // Paired with the label so a failure names the row that moved.
        expect([label, current.get(label)]).toEqual([label, hadBoundary]);
      }
      previous = current;
    }
  });
});
