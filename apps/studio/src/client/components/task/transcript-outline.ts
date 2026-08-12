import { type TranscriptFormat } from "./transcript-actions";

export interface TranscriptLandmark {
  /** 0 for the session heading, 1 for a turn, 2 for a tool call inside one. */
  depth: number;
  label: string;
  /** 0-indexed line the landmark sits on, which is where jumping to it lands. */
  line: number;
}

/**
 * The places in a transcript worth jumping to, for the viewer's outline rail.
 *
 * A transcript runs to tens of thousands of lines, so it is read by landing on
 * the turn you want rather than by scrolling to it. Landmarks are derived from
 * the rendered text rather than from the session record, so the line each one
 * reports is a line of exactly what the viewer is showing, in either format.
 */
export function transcriptLandmarks(
  content: string,
  format: TranscriptFormat,
): TranscriptLandmark[] {
  const lines = content.split("\n");
  return format === "json" ? jsonLandmarks(lines) : markdownLandmarks(lines);
}

// One entry per message, keyed off the `role` the session record stores. Enough
// to find the turn you're after in a record whose shape is otherwise only
// meaningful to a debugger.
function jsonLandmarks(lines: string[]): TranscriptLandmark[] {
  const landmarks: TranscriptLandmark[] = [];

  for (const [line, text] of lines.entries()) {
    const role = /^\s*"role":\s*"(?<role>[^"]*)"/.exec(text)?.groups?.role;
    if (role !== undefined) {
      landmarks.push({
        depth: 1,
        label: `${landmarks.length + 1}. ${role}`,
        line,
      });
    }
  }

  return landmarks;
}

/**
 * The headings `sessionToMarkdown` writes, and only those.
 *
 * Matching any `#` line instead would outline the transcript's *contents*: a
 * turn that writes a README puts that README's headings in the body verbatim,
 * unfenced, because tool inputs are rendered as XML rather than in a code
 * block. Those read as top-level sections and bury the turns among them. The
 * generator's own vocabulary is a closed set, so this asks for it directly.
 */
const HEADINGS: { depth: number; pattern: RegExp }[] = [
  { depth: 0, pattern: /^# Session: / },
  {
    depth: 1,
    pattern:
      /^## (?:Latest Persisted Context Snapshot|Project Context|System|User \(Turn |Assistant \(User Turn )/,
  },
  {
    depth: 2,
    pattern:
      /^### (?:Tool Call |Tool Result |Persisted Data: |Sources|System Context |Agent Context |Assistant Context )/,
  },
];

function markdownLandmarks(lines: string[]): TranscriptLandmark[] {
  const landmarks: TranscriptLandmark[] = [];
  // Tool output *is* fenced, and is frequently markdown itself (the fence is
  // tagged `markdown` precisely because it can be), so a transcript of a session
  // about transcripts would otherwise outline the example inside it. Fences
  // lengthen to survive nesting, so only a run at least as long as the one that
  // opened it closes it.
  let openFence: null | string = null;

  for (const [line, text] of lines.entries()) {
    const fence = /^\s*(?<ticks>`{3,})/.exec(text)?.groups?.ticks;

    if (openFence !== null) {
      if (fence !== undefined && fence.length >= openFence.length) {
        openFence = null;
      }
      continue;
    }
    if (fence !== undefined) {
      openFence = fence;
      continue;
    }

    const heading = HEADINGS.find(({ pattern }) => pattern.test(text));
    if (heading) {
      landmarks.push({
        depth: heading.depth,
        // The ISO timestamp each heading carries is what the body is for; in a
        // rail it costs more width than every label put together.
        label: text
          .replace(/^#+ /, "")
          .replace(/ @ \d{4}-\d\d-\d\dT[\d:.]+Z.*$/, ""),
        line,
      });
    }
  }

  return landmarks;
}
