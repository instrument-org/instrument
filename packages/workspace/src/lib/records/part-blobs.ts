import { SessionMessagePart } from "../../schemas/session/message-part";
import { isToolPart } from "../is-tool-part";
import { isBlobName } from "./blobs";

/**
 * A part's bytes as a log keeps them. A tool that returns a file (`read_file`
 * on an image, a PDF, audio or video) puts it in its output as base64; a log
 * keeps the bytes in a blob instead, and the blob's name, media type and size
 * where `base64Data` was:
 *
 *     { base64Data: "iVBOR…", mimeType: "image/png", … }
 *     { blob: "sha256-….png", mediaType: "image/png", bytes: 5120, mimeType: "image/png", … }
 *
 * An object with a `blob`, `bytes` or `mediaType` of its own, or whose
 * `base64Data` is not base64 as Node writes it, keeps its bytes inline, so a
 * part that goes to a log and back is the part it was.
 */

export type SaveBlob = (
  bytes: Uint8Array,
  mediaType: string,
) => Promise<string>;

export type LoadBlob = (name: string) => Promise<Uint8Array>;

const UNKNOWN_MEDIA_TYPE = "application/octet-stream";

/** The part with every `base64Data` in its output saved as a blob. */
export function partToRecord(
  part: SessionMessagePart.Type,
  save: SaveBlob,
): Promise<SessionMessagePart.Type> {
  return withOutput(part, async (object) => {
    const { base64Data, ...rest } = object;
    if (
      typeof base64Data !== "string" ||
      "blob" in rest ||
      "bytes" in rest ||
      "mediaType" in rest
    ) {
      return object;
    }
    const bytes = Buffer.from(base64Data, "base64");
    if (bytes.toString("base64") !== base64Data) {
      return object;
    }
    const mediaType =
      typeof rest.mimeType === "string" ? rest.mimeType : UNKNOWN_MEDIA_TYPE;
    const blob = await save(bytes, mediaType);
    return { ...rest, blob, mediaType, bytes: bytes.length };
  });
}

/** The part with every blob in its output read back into `base64Data`. */
export function partFromRecord(
  part: SessionMessagePart.Type,
  load: LoadBlob,
): Promise<SessionMessagePart.Type> {
  return withOutput(part, async (object) => {
    const { blob, bytes, mediaType, ...rest } = object;
    if (
      typeof blob !== "string" ||
      !isBlobName(blob) ||
      typeof bytes !== "number" ||
      typeof mediaType !== "string" ||
      "base64Data" in rest
    ) {
      return object;
    }
    const data = await load(blob);
    return { ...rest, base64Data: Buffer.from(data).toString("base64") };
  });
}

type ObjectChange = (
  object: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

async function withOutput(
  part: SessionMessagePart.Type,
  change: ObjectChange,
): Promise<SessionMessagePart.Type> {
  if (!isToolPart(part) || part.output === undefined) {
    return part;
  }
  const output = await mapObjects(part.output, change);
  return output === part.output
    ? part
    : SessionMessagePart.coerce({ ...part, output });
}

/**
 * The value with `change` applied to every object in it, innermost first.
 * Whatever `change` leaves alone comes back as the same value.
 */
async function mapObjects(
  value: unknown,
  change: ObjectChange,
): Promise<unknown> {
  if (Array.isArray(value)) {
    const items = await Promise.all(
      value.map((item) => mapObjects(item, change)),
    );
    return items.every((item, index) => item === value[index]) ? value : items;
  }
  if (!isRecord(value)) {
    return value;
  }
  const entries = await Promise.all(
    Object.entries(value).map(
      async ([key, item]): Promise<[string, unknown]> => [
        key,
        await mapObjects(item, change),
      ],
    ),
  );
  const same = entries.every(([key, item]) => item === value[key]);
  return change(same ? value : Object.fromEntries(entries));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
