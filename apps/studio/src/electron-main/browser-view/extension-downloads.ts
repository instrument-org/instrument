import { type BrowserDownload } from "@/electron-main/stores/workspace/downloads";
import { z } from "zod";

/** A download as `chrome.downloads` describes one (`DownloadItem`). */
export type ChromeDownload = {
  byExtensionId?: string;
  byExtensionName?: string;
  bytesReceived: number;
  canResume: boolean;
  danger: "safe";
  endTime?: string;
  error?: string;
  exists: boolean;
  fileSize: number;
  filename: string;
  finalUrl: string;
  id: number;
  incognito: false;
  mime: string;
  paused: boolean;
  referrer: string;
  startTime: string;
  state: "complete" | "in_progress" | "interrupted";
  totalBytes: number;
  url: string;
};

/**
 * A download on the browser's list as an extension reads it. `live` is
 * what only the running transfer knows; `exists` whether the file is where
 * it was saved. A stop the network caused is Chromium's own to resume, so
 * it reads as interrupted and resumable; a download canceled or failed
 * ended for good.
 */
export function toChromeDownload(
  download: BrowserDownload,
  {
    by,
    exists,
    id,
    live,
  }: {
    by?: { id: string; name: string };
    exists: boolean;
    id: number;
    live?: { mime: string; paused: boolean };
  },
): ChromeDownload {
  const ended =
    download.state === "completed" ||
    download.state === "canceled" ||
    download.state === "failed";
  const error =
    download.state === "canceled"
      ? "USER_CANCELED"
      : download.state === "failed"
        ? download.path === null
          ? "FILE_FAILED"
          : "NETWORK_FAILED"
        : download.state === "interrupted"
          ? "NETWORK_FAILED"
          : undefined;
  const totalBytes = download.totalBytes > 0 ? download.totalBytes : -1;
  return {
    ...(by ? { byExtensionId: by.id, byExtensionName: by.name } : {}),
    bytesReceived: download.receivedBytes,
    canResume:
      download.state === "interrupted" ||
      (download.state === "progressing" && (live?.paused ?? false)),
    danger: "safe",
    ...(ended
      ? {
          endTime: new Date(
            download.endedAt ?? download.startedAt,
          ).toISOString(),
        }
      : {}),
    ...(error ? { error } : {}),
    exists,
    fileSize:
      download.state === "completed" ? download.receivedBytes : totalBytes,
    filename: download.path ?? "",
    finalUrl: download.url,
    id,
    incognito: false,
    mime: live?.mime ?? "",
    paused: download.state === "progressing" && (live?.paused ?? false),
    referrer: "",
    startTime: new Date(download.startedAt).toISOString(),
    state:
      download.state === "completed"
        ? "complete"
        : download.state === "progressing"
          ? "in_progress"
          : "interrupted",
    totalBytes,
    url: download.url,
  };
}

/** What `chrome.downloads.search` and `erase` take, the fields this answers. */
export const DownloadQuerySchema = z
  .looseObject({
    bytesReceived: z.number().optional(),
    endedAfter: z.string().optional(),
    endedBefore: z.string().optional(),
    endTime: z.string().optional(),
    error: z.string().optional(),
    exists: z.boolean().optional(),
    filename: z.string().optional(),
    filenameRegex: z.string().optional(),
    fileSize: z.number().optional(),
    finalUrl: z.string().optional(),
    finalUrlRegex: z.string().optional(),
    id: z.number().optional(),
    limit: z.number().int().min(0).optional(),
    mime: z.string().optional(),
    orderBy: z.array(z.string()).optional(),
    paused: z.boolean().optional(),
    query: z.array(z.string()).optional(),
    startedAfter: z.string().optional(),
    startedBefore: z.string().optional(),
    startTime: z.string().optional(),
    state: z.enum(["complete", "in_progress", "interrupted"]).optional(),
    totalBytes: z.number().optional(),
    totalBytesGreater: z.number().optional(),
    totalBytesLess: z.number().optional(),
    url: z.string().optional(),
    urlRegex: z.string().optional(),
  })
  .catch({});

export type DownloadQuery = z.output<typeof DownloadQuerySchema>;

/** The fields a query names to match exactly. */
const EXACT_FIELDS = [
  "bytesReceived",
  "endTime",
  "error",
  "exists",
  "filename",
  "fileSize",
  "finalUrl",
  "id",
  "mime",
  "paused",
  "startTime",
  "state",
  "totalBytes",
  "url",
] as const;

/** How many a search answers with when the query says nothing, as in Chrome. */
const DEFAULT_LIMIT = 1000;

/**
 * The downloads a `chrome.downloads.search` query matches, in its
 * `orderBy` (newest first when it names none), at most its `limit` (0 for
 * all). `query` terms match the address or file name, a leading `-`
 * excluding; a regular expression that does not compile matches nothing.
 */
export function searchDownloads(
  downloads: readonly ChromeDownload[],
  query: DownloadQuery,
): ChromeDownload[] {
  const pattern = (source: string | undefined) => {
    if (source === undefined) {
      return undefined;
    }
    try {
      return new RegExp(source);
    } catch {
      return null;
    }
  };
  const patterns = {
    filename: pattern(query.filenameRegex),
    finalUrl: pattern(query.finalUrlRegex),
    url: pattern(query.urlRegex),
  };
  const time = (value: string | undefined) =>
    value === undefined ? undefined : Date.parse(value);
  const startedAfter = time(query.startedAfter);
  const startedBefore = time(query.startedBefore);
  const endedAfter = time(query.endedAfter);
  const endedBefore = time(query.endedBefore);
  const found = downloads.filter((download) => {
    if (
      EXACT_FIELDS.some(
        (field) =>
          query[field] !== undefined && query[field] !== download[field],
      )
    ) {
      return false;
    }
    for (const [field, regex] of Object.entries(patterns)) {
      if (
        regex === null ||
        (regex && !regex.test(download[field as keyof typeof patterns]))
      ) {
        return false;
      }
    }
    const started = Date.parse(download.startTime);
    const ended =
      download.endTime === undefined ? undefined : Date.parse(download.endTime);
    if (
      (startedAfter !== undefined && !(started > startedAfter)) ||
      (startedBefore !== undefined && !(started < startedBefore)) ||
      (endedAfter !== undefined &&
        !(ended !== undefined && ended > endedAfter)) ||
      (endedBefore !== undefined &&
        !(ended !== undefined && ended < endedBefore)) ||
      (query.totalBytesGreater !== undefined &&
        !(download.totalBytes > query.totalBytesGreater)) ||
      (query.totalBytesLess !== undefined &&
        !(download.totalBytes < query.totalBytesLess))
    ) {
      return false;
    }
    const text = `${download.url} ${download.filename}`.toLowerCase();
    return (query.query ?? []).every((term) =>
      term.startsWith("-")
        ? !text.includes(term.slice(1).toLowerCase())
        : text.includes(term.toLowerCase()),
    );
  });
  const order = query.orderBy ?? ["-startTime"];
  const sorted = found.toSorted((a, b) => {
    for (const key of order) {
      const descending = key.startsWith("-");
      const field = (descending ? key.slice(1) : key) as keyof ChromeDownload;
      const left = a[field] ?? "";
      const right = b[field] ?? "";
      if (left !== right) {
        return (left < right ? -1 : 1) * (descending ? -1 : 1);
      }
    }
    return 0;
  });
  const limit = query.limit ?? DEFAULT_LIMIT;
  return limit === 0 ? sorted : sorted.slice(0, limit);
}

/** The fields `chrome.downloads.onChanged` reports a change in, as Chrome's `DownloadDelta` names them. */
const DELTA_FIELDS = [
  "canResume",
  "danger",
  "endTime",
  "error",
  "exists",
  "fileSize",
  "filename",
  "finalUrl",
  "mime",
  "paused",
  "startTime",
  "state",
  "totalBytes",
  "url",
] as const;

type DeltaField = (typeof DELTA_FIELDS)[number];

/** A change to a download as `chrome.downloads.onChanged` tells it. */
export type DownloadDelta = { id: number } & {
  [Field in DeltaField]?: {
    current?: ChromeDownload[Field];
    previous?: ChromeDownload[Field];
  };
};

/** What changed from `before` to `after` that `onChanged` tells of, or null for nothing; progress alone is not told, as in Chrome. */
export function downloadDelta(
  before: ChromeDownload,
  after: ChromeDownload,
): DownloadDelta | null {
  const delta: DownloadDelta = { id: after.id };
  let changed = false;
  for (const field of DELTA_FIELDS) {
    if (before[field] !== after[field]) {
      changed = true;
      Object.assign(delta, {
        [field]: {
          ...(before[field] === undefined ? {} : { previous: before[field] }),
          ...(after[field] === undefined ? {} : { current: after[field] }),
        },
      });
    }
  }
  return changed ? delta : null;
}

/**
 * A `filename` an extension asked to save to, as a path below the Downloads
 * folder, or null for one Chrome refuses: empty, absolute, naming a drive,
 * or with an empty, `.` or `..` part.
 */
export function downloadSubpath(filename: string): null | string {
  const parts = filename.split(/[/\\]/);
  if (
    filename.includes(":") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    return null;
  }
  return parts.join("/");
}
