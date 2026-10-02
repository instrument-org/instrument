import type {
  AssistantModelMessage,
  DataContent,
  FilePart,
  ImagePart,
  ModelMessage,
  ProviderReference,
  ToolModelMessage,
  ToolResultPart,
  UserModelMessage,
} from "ai";

/** What a media visitor asks the traversal to do with the part it saw. */
export type ModelMediaEdit =
  | { bytes: Buffer; mediaType: string; state: "replaced" }
  | { note: string; state: "dropped" }
  | { state: "unchanged" };

export interface ModelPartVisitor {
  media?: (part: ModelMediaPart) => ModelMediaEdit | Promise<ModelMediaEdit>;
  text?: (text: string) => string;
}

type AssistantPart = Extract<
  AssistantModelMessage["content"],
  unknown[]
>[number];

/** Every shape a file or image part's payload can take. */
type MediaSource = FilePart["data"] | ImagePart["image"];

/** One media part, as a pass sees it whatever shape it had in the message. */
interface ModelMediaPart {
  /** Decoded bytes, or undefined for media the provider fetches itself. */
  bytes: Buffer | undefined;
  /**
   * The type the part claims, which the bytes are free to contradict, and which
   * an image part is free to omit. A pass that cannot act without one says so
   * itself rather than being skipped here.
   */
  mediaType: string | undefined;
}

/** A tool result whose output is a mix of text and media. */
type ToolOutputContent = Extract<ToolResultPart["output"], { type: "content" }>;

type ToolOutputItem = ToolOutputContent["value"][number];
/** A tool output item reduced to what a pass can act on, plus how to put it back. */
type ToolOutputItemView =
  | {
      data: string;
      kind: "media";
      mediaType: string;
      replace: (edit: { bytes: Buffer; mediaType: string }) => ToolOutputItem;
    }
  | { kind: "opaque" }
  | { kind: "text"; replace: (text: string) => ToolOutputItem; text: string };
type ToolPart = ToolModelMessage["content"][number];

type UserPart = Extract<UserModelMessage["content"], unknown[]>[number];

/**
 * Visit every text and media part in a conversation, whatever role carries it.
 *
 * The passes that run before a request -- surrogate stripping, capability
 * filtering, image resizing -- each used to walk the `ModelMessage` union
 * themselves, re-deriving which roles hold which part shapes. Every one of them
 * is a place to omit a shape silently, and each omission is a hole in a
 * guarantee stated elsewhere as absolute. Here the union is walked once, with
 * an exhaustiveness check per shape, so a part the SDK adds fails to compile
 * instead of slipping past every pass at once.
 *
 * A visitor sees only the part: text as a string, media as decoded bytes and
 * the type they claim. Deciding whether a slot holds base64, a data URL, or raw
 * bytes belongs to the traversal, so a pass cannot get the round trip wrong.
 */
export async function mapModelMessageParts(
  messages: ModelMessage[],
  visit: ModelPartVisitor,
): Promise<ModelMessage[]> {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    result.push(await mapMessage(message, visit));
  }
  return result;
}

/**
 * Reduce a tool output item to the text or media it carries.
 *
 * The single place that decides which item shapes hold what. `replace` closes
 * over the item it came from, so a caller writes a value back without needing
 * the shape again.
 */
export function viewToolOutputItem(item: ToolOutputItem): ToolOutputItemView {
  switch (item.type) {
    case "custom":
    case "file-id":
    case "file-reference":
    case "file-url":
    case "image-file-id":
    case "image-file-reference":
    case "image-url": {
      // A reference rather than content: no bytes we hold, and no media type to
      // route on, so there is nothing for a pass to act on.
      return { kind: "opaque" };
    }
    case "file": {
      // Only inline bytes are content a pass can act on; a URL, a provider
      // reference, or inline text is left for the provider.
      if (item.data.type !== "data") {
        return { kind: "opaque" };
      }
      const { data } = item.data;
      return {
        data:
          typeof data === "string"
            ? data
            : Buffer.from(
                data instanceof ArrayBuffer ? new Uint8Array(data) : data,
              ).toString("base64"),
        kind: "media",
        mediaType: item.mediaType,
        replace: ({ bytes, mediaType }) => ({
          ...item,
          data: { data: bytes.toString("base64"), type: "data" },
          mediaType,
        }),
      };
    }
    case "file-data":
    case "image-data": {
      return {
        data: item.data,
        kind: "media",
        mediaType: item.mediaType,
        replace: ({ bytes, mediaType }) => ({
          ...item,
          data: bytes.toString("base64"),
          mediaType,
        }),
      };
    }
    case "text": {
      return {
        kind: "text",
        replace: (text) => ({ ...item, text }),
        text: item.text,
      };
    }
    default: {
      const unhandled: never = item;
      return unhandled;
    }
  }
}

function decodeMediaData(data: MediaSource): Buffer | undefined {
  if (isTaggedFileData(data)) {
    return data.type === "data" ? decodeMediaData(data.data) : undefined;
  }
  if (isProviderReference(data)) {
    // Held by the provider, so there are no bytes here to act on.
    return;
  }
  if (data instanceof URL) {
    // The provider fetches it, so there is nothing here to measure or resize.
    return;
  }
  if (typeof data !== "string") {
    return Buffer.from(
      data instanceof Uint8Array ? data : new Uint8Array(data),
    );
  }
  if (data.startsWith("data:")) {
    const marker = ";base64,";
    const index = data.indexOf(marker);
    if (index === -1) {
      return;
    }
    return toBuffer(data.slice(index + marker.length));
  }
  return toBuffer(data);
}

/** Turn bytes back into the form the slot they came from carries. */
function encodeLikeSource(
  source: ImagePart["image"],
  bytes: Buffer,
  mediaType: string,
): DataContent {
  if (typeof source === "string") {
    return source.startsWith("data:")
      ? `data:${mediaType};base64,${bytes.toString("base64")}`
      : bytes.toString("base64");
  }
  if (source instanceof URL || isProviderReference(source)) {
    return bytes.toString("base64");
  }
  return new Uint8Array(bytes);
}

function isProviderReference(data: MediaSource): data is ProviderReference {
  return (
    typeof data === "object" &&
    !(data instanceof URL) &&
    !(data instanceof Uint8Array) &&
    !(data instanceof ArrayBuffer) &&
    data.type === undefined
  );
}

function isTaggedFileData(
  data: MediaSource,
): data is Extract<FilePart["data"], { type: string }> {
  return (
    typeof data === "object" &&
    !(data instanceof URL) &&
    !(data instanceof Uint8Array) &&
    !(data instanceof ArrayBuffer) &&
    typeof data.type === "string"
  );
}

async function mapAssistantPart(
  part: AssistantPart,
  visit: ModelPartVisitor,
): Promise<AssistantPart> {
  switch (part.type) {
    case "custom":
    case "reasoning-file": {
      // Provider-specific content and reasoning output replayed as-is. Nothing
      // stores either today (see llm-request), so this is only reached by a
      // caller that builds them itself.
      return part;
    }
    case "file": {
      return mapFilePart(part, visit);
    }
    case "reasoning": {
      // A provider replays a reasoning block against a signature computed over
      // its exact text, so editing the text invalidates the block.
      return part;
    }
    case "text": {
      return { ...part, text: mapText(part.text, visit) };
    }
    case "tool-approval-request": {
      return part;
    }
    case "tool-call": {
      // The input is serialized as JSON, which escapes a lone surrogate rather
      // than emitting it raw.
      return part;
    }
    case "tool-result": {
      return mapToolResultPart(part, visit);
    }
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}

async function mapFilePart(
  part: FilePart,
  visit: ModelPartVisitor,
): Promise<FilePart | { text: string; type: "text" }> {
  const edit = await visitMedia({
    data: part.data,
    mediaType: part.mediaType,
    visit,
  });
  if (edit.state === "dropped") {
    return { text: edit.note, type: "text" };
  }
  if (edit.state === "replaced") {
    const { data } = part;
    return {
      ...part,
      data: isTaggedFileData(data)
        ? {
            data:
              data.type === "data" && typeof data.data === "string"
                ? encodeLikeSource(data.data, edit.bytes, edit.mediaType)
                : new Uint8Array(edit.bytes),
            type: "data",
          }
        : encodeLikeSource(data, edit.bytes, edit.mediaType),
      mediaType: edit.mediaType,
    };
  }
  return part;
}

async function mapImagePart(
  part: ImagePart,
  visit: ModelPartVisitor,
): Promise<ImagePart | { text: string; type: "text" }> {
  const edit = await visitMedia({
    data: part.image,
    mediaType: part.mediaType,
    visit,
  });
  if (edit.state === "dropped") {
    return { text: edit.note, type: "text" };
  }
  if (edit.state === "replaced") {
    return {
      ...part,
      image: encodeLikeSource(part.image, edit.bytes, edit.mediaType),
      mediaType: edit.mediaType,
    };
  }
  return part;
}

async function mapMessage(
  message: ModelMessage,
  visit: ModelPartVisitor,
): Promise<ModelMessage> {
  switch (message.role) {
    case "assistant": {
      if (typeof message.content === "string") {
        return { ...message, content: mapText(message.content, visit) };
      }
      const content: AssistantPart[] = [];
      for (const part of message.content) {
        content.push(await mapAssistantPart(part, visit));
      }
      return { ...message, content };
    }
    case "system": {
      return { ...message, content: mapText(message.content, visit) };
    }
    case "tool": {
      const content: ToolPart[] = [];
      for (const part of message.content) {
        content.push(await mapToolPart(part, visit));
      }
      return { ...message, content };
    }
    case "user": {
      if (typeof message.content === "string") {
        return { ...message, content: mapText(message.content, visit) };
      }
      const content: UserPart[] = [];
      for (const part of message.content) {
        content.push(await mapUserPart(part, visit));
      }
      return { ...message, content };
    }
    default: {
      const unhandled: never = message;
      return unhandled;
    }
  }
}

function mapText(text: string, visit: ModelPartVisitor) {
  return visit.text ? visit.text(text) : text;
}

async function mapToolOutputItem(
  item: ToolOutputItem,
  visit: ModelPartVisitor,
): Promise<ToolOutputItem> {
  const view = viewToolOutputItem(item);
  switch (view.kind) {
    case "media": {
      const edit = await visitMedia({
        data: view.data,
        mediaType: view.mediaType,
        visit,
      });
      if (edit.state === "dropped") {
        return { text: edit.note, type: "text" };
      }
      return edit.state === "replaced" ? view.replace(edit) : item;
    }
    case "opaque": {
      return item;
    }
    case "text": {
      return view.replace(mapText(view.text, visit));
    }
  }
}

async function mapToolPart(
  part: ToolPart,
  visit: ModelPartVisitor,
): Promise<ToolPart> {
  switch (part.type) {
    case "tool-approval-response": {
      return part.reason === undefined
        ? part
        : { ...part, reason: mapText(part.reason, visit) };
    }
    case "tool-result": {
      return mapToolResultPart(part, visit);
    }
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}

async function mapToolResultPart(
  part: ToolResultPart,
  visit: ModelPartVisitor,
): Promise<ToolResultPart> {
  const { output } = part;
  switch (output.type) {
    case "content": {
      const value: ToolOutputContent["value"] = [];
      for (const item of output.value) {
        value.push(await mapToolOutputItem(item, visit));
      }
      return { ...part, output: { ...output, value } };
    }
    case "error-json":
    case "json": {
      // `JSON.stringify` escapes a lone surrogate as `\uXXXX` rather than
      // emitting it raw, so it cannot break the encoding of the request the way
      // a bare string can. No tool returns this shape today.
      return part;
    }
    case "error-text":
    case "text": {
      return {
        ...part,
        output: { ...output, value: mapText(output.value, visit) },
      };
    }
    case "execution-denied": {
      return output.reason === undefined
        ? part
        : {
            ...part,
            output: { ...output, reason: mapText(output.reason, visit) },
          };
    }
    default: {
      const unhandled: never = output;
      return unhandled;
    }
  }
}

async function mapUserPart(
  part: UserPart,
  visit: ModelPartVisitor,
): Promise<UserPart> {
  switch (part.type) {
    case "file": {
      return mapFilePart(part, visit);
    }
    case "image": {
      return mapImagePart(part, visit);
    }
    case "text": {
      return { ...part, text: mapText(part.text, visit) };
    }
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}

function toBuffer(base64: string) {
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return;
  }
}

async function visitMedia({
  data,
  mediaType,
  visit,
}: {
  data: MediaSource;
  mediaType: string | undefined;
  visit: ModelPartVisitor;
}): Promise<ModelMediaEdit> {
  if (!visit.media) {
    return { state: "unchanged" };
  }
  return visit.media({ bytes: decodeMediaData(data), mediaType });
}
