/**
 * One line of a chat's JSON Lines file, as feedback lists it: the record
 * itself, and a gist read off it in the record's own terms (its `t`, a
 * part's `type`) with the words a person can scan for beside them.
 */
export type RecordRow = {
  at?: string;
  detail: string;
  failed: boolean;
  /** The line indented as JSON, or the line as it is when it is not JSON. */
  json: string;
  kind: string;
  seq?: number;
};

const DETAIL_MAX = 200;

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function oneLine(value: string) {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, DETAIL_MAX);
}

/** What a part says, by its type: its text, or what a tool was asked to do. */
function partDetail(part: Fields) {
  const type = text(part.type);
  if (type === "text" || type === "reasoning") {
    return text(part.text);
  }
  if (type.startsWith("tool-") && isFields(part.input)) {
    const input = part.input;
    return (
      text(input.explanation) || text(input.command) || text(input.filePath)
    );
  }
  return "";
}

function recordDetail(record: Fields) {
  switch (record.t) {
    case "session": {
      return text(record.startedAs) || text(record.id);
    }
    case "message": {
      if (!isFields(record.message)) {
        return "";
      }
      const metadata = isFields(record.message.metadata)
        ? record.message.metadata
        : {};
      const model = isFields(metadata.aiGatewayModel)
        ? text(metadata.aiGatewayModel.name)
        : "";
      return [text(record.message.role), model].filter(Boolean).join(" · ");
    }
    case "part": {
      return isFields(record.part) ? partDetail(record.part) : "";
    }
    case "retract": {
      return Array.isArray(record.messages)
        ? `${record.messages.length} messages`
        : "";
    }
    case "stop": {
      return text(record.by);
    }
    case "sites": {
      return Array.isArray(record.visited) ? record.visited.join(", ") : "";
    }
    case "set": {
      return `${text(record.field)} = ${JSON.stringify(record.value)}`;
    }
    default: {
      return "";
    }
  }
}

/** Each non-blank line of a JSON Lines file as a row. */
export function recordRows(content: string): RecordRow[] {
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): RecordRow => {
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        return { detail: oneLine(line), failed: true, json: line, kind: "?" };
      }
      if (!isFields(record)) {
        return { detail: oneLine(line), failed: false, json: line, kind: "?" };
      }
      const part = record.t === "part" && isFields(record.part) && record.part;
      return {
        at: text(record.at) || undefined,
        detail: oneLine(recordDetail(record)),
        failed: part ? part.state === "output-error" : false,
        json: JSON.stringify(record, null, 2),
        kind: part ? text(part.type) || "part" : text(record.t) || "?",
        seq: typeof record.seq === "number" ? record.seq : undefined,
      };
    });
}
