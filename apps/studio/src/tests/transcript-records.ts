import { type TranscriptRecords } from "@/client/components/transcript/transcript-data";

/**
 * Records for a transcript under test, with nothing in them but what is
 * given: no tasks, commands or notes, and every path where it was named.
 */
export function transcriptRecords(
  given: Partial<TranscriptRecords> = {},
): TranscriptRecords {
  return {
    commands: [],
    developerNotes: { bodies: {}, notes: [] },
    hostPathOf: (path) => path,
    parts: [],
    taskMessages: new Map(),
    tasks: [],
    ...given,
  };
}
