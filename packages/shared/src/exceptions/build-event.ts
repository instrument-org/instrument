import { redactSecrets, redactUrlQueries } from "../secrets";
import { type CaptureContext } from "../types/exceptions";
import { ForwardedException } from "./forwarded";
import { normalize } from "./normalize";
import {
  type Breadcrumb,
  type EventContexts,
  type ExceptionContext,
  type ExceptionEvent,
  type ExceptionProcess,
  type ExceptionValue,
  type SerializedError,
  type StackFrame,
} from "./schema";
import { serializeError } from "./serialize-error";
import { sha256Hex } from "./sha256";
import { type ParsedFrame, parseStack } from "./stack-parser";

/**
 * Where paths in a stack are rewritten from: the app's own folder (and any
 * URL its pages load from) to `app:///`, and the home folder to `~`.
 */
export type EventPaths = {
  appRoot?: string;
  home?: string;
  urlRoots?: readonly string[];
};

/** How many in-app frames of the deepest error say what a problem is. */
const FINGERPRINT_FRAMES = 5;

/**
 * Build the complete event for one capture, the way Sentry's SDK gets an
 * exception into its best state: the error and every error it links to, each
 * with its frames parsed, in-app decided on the real path and the path then
 * rewritten; the error's own properties as data; the caller's context; and a
 * fingerprint that stays the same across builds. The home folder reads `~`
 * everywhere in it, and the messages, values and data have their secrets
 * and web addresses' queries taken out; nothing else is.
 */
export function buildExceptionEvent(
  error: unknown,
  {
    breadcrumbs,
    context = {},
    contexts,
    defaultArea,
    now = Date.now(),
    paths,
    process = "main",
  }: {
    breadcrumbs: readonly Breadcrumb[];
    context?: CaptureContext;
    contexts: EventContexts;
    defaultArea: string;
    now?: number;
    paths: EventPaths;
    process?: ExceptionProcess;
  },
): ExceptionEvent {
  const forwarded = error instanceof ForwardedException ? error : undefined;
  const serialized = forwarded?.serialized ?? serializeError(error);
  const mechanism = context.mechanism ?? "generic";
  const scrub = eventScrubber(paths.home);
  const exceptions = linkExceptions(serialized, mechanism, paths, scrub);
  return {
    area: context.area ?? defaultArea,
    breadcrumbs: breadcrumbs.map((crumb) => ({
      ...crumb,
      ...(crumb.data && { data: toRecord(scrub.deep(crumb.data)) }),
      message: scrub.text(crumb.message),
    })),
    context: eventContext(context, scrub.text),
    contexts,
    count: 1,
    ...(context.data && {
      data: toRecord(scrub.deep(normalize(context.data))),
    }),
    exceptions,
    fingerprint: fingerprintOf(exceptions),
    firstAt: now,
    handled: context.handled ?? true,
    id: crypto.randomUUID().replaceAll("-", ""),
    lastAt: now,
    level: context.level ?? "error",
    mechanism,
    process: forwarded?.process ?? process,
    timestamp: now,
  };
}

/**
 * The captured error and everything it links to, deepest first and the
 * captured one last, numbered as Sentry numbers them: the captured error is
 * 0 and each linked one its order of discovery.
 */
function linkExceptions(
  root: SerializedError,
  mechanism: string,
  paths: EventPaths,
  scrub: Scrubber,
): ExceptionValue[] {
  const found: ExceptionValue[] = [];
  const visit = (
    error: SerializedError,
    link: { parentId: number; source: string } | undefined,
  ) => {
    const exceptionId = found.length;
    const value: ExceptionValue = {
      ...(error.data && { data: toRecord(scrub.deep(error.data)) }),
      frames: parseStack(error.stack ?? "").map((frame) =>
        toFrame(frame, paths, scrub.path),
      ),
      mechanism: {
        exceptionId,
        ...(link
          ? { parentId: link.parentId, source: link.source, type: "chained" }
          : { type: mechanism }),
        ...(error.synthetic && { synthetic: true }),
        ...(error.links?.some((child) => child.source !== "cause") && {
          isGroup: true,
        }),
      },
      rawStack: scrub.text(error.stack ?? ""),
      type: error.type,
      value: scrub.text(error.value),
    };
    found.push(value);
    for (const child of error.links ?? []) {
      visit(child.error, { parentId: exceptionId, source: child.source });
    }
  };
  visit(root, undefined);
  return found.reverse();
}

function toFrame(
  frame: ParsedFrame,
  paths: EventPaths,
  scrub: (text: string) => string,
): StackFrame {
  const raw = frame.filename ?? "<unknown>";
  const relative = appRelativePath(raw, paths);
  const module = nodeModuleName(raw) ?? (relative && moduleOfAppFile(relative));
  return {
    absPath: scrub(raw),
    ...(frame.colno !== undefined && { colno: frame.colno }),
    filename: relative === undefined ? scrub(raw) : `app:///${relative}`,
    function: frame.function ?? "?",
    ...(frame.inApp !== undefined && { inApp: frame.inApp }),
    ...(frame.lineno !== undefined && { lineno: frame.lineno }),
    ...(module && { module }),
  };
}

/** A path's place inside the app's folder or one of its URLs, if it has one. */
function appRelativePath(raw: string, paths: EventPaths): string | undefined {
  for (const root of paths.urlRoots ?? []) {
    if (raw.startsWith(root)) {
      return trimSlashes(raw.slice(root.length).split(/[?#]/)[0] ?? "");
    }
  }
  if (!paths.appRoot) {
    return undefined;
  }
  const path = toSlashes(raw);
  const root = toSlashes(paths.appRoot).replace(/\/+$/, "");
  // A Windows drive letter is spelled either way.
  const [left, right] = /^[a-z]:/i.test(root)
    ? [path.toLowerCase(), root.toLowerCase()]
    : [path, root];
  if (left === right || left.startsWith(`${right}/`)) {
    return trimSlashes(path.slice(root.length));
  }
  return undefined;
}

/** The package a `node_modules` path is in, scoped names included. */
function nodeModuleName(raw: string): string | undefined {
  const path = toSlashes(raw);
  const index = path.lastIndexOf("node_modules/");
  if (index === -1) {
    return undefined;
  }
  const [first, second] = path.slice(index + "node_modules/".length).split("/");
  if (!first) {
    return undefined;
  }
  return first.startsWith("@") && second ? `${first}/${second}` : first;
}

/**
 * An app file as a module: its path without the extension or the content
 * hash a bundler names a chunk with, so it is the same in every build.
 */
function moduleOfAppFile(relative: string): string {
  return relative
    .replace(/\.[cm]?[jt]sx?$/, "")
    .replace(/-[\w-]{8}$/, "")
    .replace(/\.[0-9a-f]{8,}$/, "");
}

function toSlashes(path: string) {
  return path.replaceAll("\\", "/");
}

function trimSlashes(path: string) {
  return path.replace(/^\/+/, "");
}

/**
 * What makes two events one problem: the deepest error's type, and the
 * function and module of the innermost in-app frames of the deepest error
 * that has any, with no line numbers so a rebuild does not split it. With no
 * in-app frame anywhere (an `fs` error, a fetch from a package), the
 * captured error's mechanism, type and message stand in, numbers taken out.
 */
export function fingerprintOf(exceptions: readonly ExceptionValue[]): string {
  const captured = exceptions.at(-1);
  const chain = causeChain(exceptions);
  const deepest = chain.at(-1) ?? captured;
  const withFrames = chain
    .toReversed()
    .find((exception) => exception.frames.some((frame) => frame.inApp));
  const frames = (withFrames?.frames ?? [])
    .filter((frame) => frame.inApp)
    .slice(-FINGERPRINT_FRAMES)
    .reverse()
    .map((frame) => `${frame.module ?? frame.filename} ${frame.function}`);
  const parts =
    frames.length > 0
      ? [deepest?.type ?? "Error", ...frames]
      : [
          captured?.mechanism.type ?? "generic",
          deepest?.type ?? "Error",
          (deepest?.value ?? "").replaceAll(/\d+/g, "#"),
        ];
  return sha256Hex(parts.join("\n")).slice(0, 32);
}

/** The captured error, then its cause, then that one's cause, and on. */
function causeChain(
  exceptions: readonly ExceptionValue[],
): readonly ExceptionValue[] {
  const byId = new Map(
    exceptions.map((exception) => [exception.mechanism.exceptionId, exception]),
  );
  const chain: ExceptionValue[] = [];
  let current = byId.get(0);
  while (current) {
    chain.push(current);
    const parentId = current.mechanism.exceptionId;
    current = exceptions.find(
      (exception) =>
        exception.mechanism.parentId === parentId &&
        exception.mechanism.source === "cause",
    );
  }
  return chain;
}

function eventContext(
  context: CaptureContext,
  scrub: (text: string) => string,
): ExceptionContext {
  const {
    chatId,
    componentStack,
    messageId,
    modelId,
    providerId,
    rpcPath,
    sessionId,
    toolCallId,
    toolName,
  } = context;
  return Object.fromEntries(
    Object.entries({
      chatId,
      componentStack,
      messageId,
      modelId,
      providerId,
      rpcPath,
      sessionId,
      toolCallId,
      toolName,
    }).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, scrub(value)]],
    ),
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : { value };
}

type Scrubber = {
  deep: (value: unknown) => unknown;
  /** A frame's file, which only has the home folder read as `~`. */
  path: (text: string) => string;
  text: (text: string) => string;
};

/**
 * Reads the home folder as `~` in a string, or in every string of a value,
 * and takes out secrets and web addresses' queries.
 */
function eventScrubber(home: string | undefined): Scrubber {
  const path = (value: string) => (home ? value.split(home).join("~") : value);
  const text = (value: string) =>
    redactUrlQueries(redactSecrets(path(value)));
  const deep = (value: unknown): unknown => {
    if (typeof value === "string") {
      return text(value);
    }
    if (Array.isArray(value)) {
      return value.map(deep);
    }
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, deep(item)]),
      );
    }
    return value;
  };
  return { deep, path, text };
}
