// Ported from Sentry's JavaScript SDK (packages/core/src/utils/stacktrace.ts
// and node-stack-trace.ts), which forked it from
// https://github.com/felixge/node-stack-trace.
//
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Copyright (c) 2011 Felix Geisendörfer (felix@debuggable.com)
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

/** One line of a V8 stack, as the line itself says it. */
export type ParsedFrame = {
  colno?: number;
  /** The path or URL the line names, `file://` and `%20` taken out. */
  filename?: string;
  function?: string;
  /** Whether the path is the app's own code rather than Node's or a package's. */
  inApp?: boolean;
  lineno?: number;
};

/** The most frames a stack keeps, counted from the frame that threw. */
export const STACK_FRAME_LIMIT = 50;

const UNKNOWN_FUNCTION = "?";

// Lines over this are cut before matching: the expressions backtrack, and a
// minified URL can make that take seconds.
const MAX_LINE_LENGTH = 1024;

const WEBPACK_ERROR_REGEXP = /\(error: (.*)\)/;
const FILENAME_MATCH = /^\s*[-]{4,}$/;
const FULL_MATCH =
  /at (?:async )?(?:(.+?)\s+\()?(?:(.+):(\d+):(\d+)?|([^)]+))\)?/;
const DATA_URI_MATCH = /at (?:async )?(.+?) \(data:(.*?),/;
// A frame line starts with `at` after its indent. Anything else in a stack is
// the error's own message, which can say "at" anywhere and is no frame.
const FRAME_LINE = /^\s*at /;

/**
 * The frames of a V8 stack (Node, Electron, Chromium), oldest call first and
 * the one that threw last, at most `STACK_FRAME_LIMIT` of them counted from
 * the throw.
 */
export function parseStack(stack: string): ParsedFrame[] {
  const frames: ParsedFrame[] = [];
  for (const rawLine of stack.split("\n")) {
    const line =
      rawLine.length > MAX_LINE_LENGTH
        ? rawLine.slice(0, MAX_LINE_LENGTH)
        : rawLine;
    const cleaned = WEBPACK_ERROR_REGEXP.test(line)
      ? line.replace(WEBPACK_ERROR_REGEXP, "$1")
      : line;
    if (!FRAME_LINE.test(cleaned) && !FILENAME_MATCH.test(cleaned)) {
      continue;
    }
    const frame = parseStackLine(cleaned);
    if (frame) {
      frames.push(frame);
    }
    if (frames.length >= STACK_FRAME_LIMIT) {
      break;
    }
  }
  const kept = frames.reverse();
  const fallbackFilename = kept.at(-1)?.filename;
  return kept.map((frame) => ({
    ...frame,
    filename: frame.filename ?? fallbackFilename,
    function: frame.function ?? UNKNOWN_FUNCTION,
  }));
}

/** One line of a V8 stack, or `undefined` for a line that is no frame. */
export function parseStackLine(line: string): ParsedFrame | undefined {
  const dataUriMatch = DATA_URI_MATCH.exec(line);
  if (dataUriMatch) {
    return {
      filename: `<data:${dataUriMatch[2] ?? ""}>`,
      function: dataUriMatch[1],
    };
  }

  const lineMatch = FULL_MATCH.exec(line);
  if (lineMatch) {
    let object: string | undefined;
    let method: string | undefined;
    let functionName: string | undefined;
    let typeName: string | undefined;
    let methodName: string | undefined;

    if (lineMatch[1]) {
      functionName = lineMatch[1];

      let methodStart = functionName.lastIndexOf(".");
      if (functionName[methodStart - 1] === ".") {
        methodStart--;
      }

      if (methodStart > 0) {
        object = functionName.slice(0, methodStart);
        method = functionName.slice(methodStart + 1);
        const objectEnd = object.indexOf(".Module");
        if (objectEnd > 0) {
          functionName = functionName.slice(objectEnd + 1);
          object = object.slice(0, objectEnd);
        }
      }
      typeName = undefined;
    }

    if (method) {
      typeName = object;
      methodName = method;
    }

    if (method === "<anonymous>") {
      methodName = undefined;
      functionName = undefined;
    }

    if (functionName === undefined) {
      methodName = methodName || UNKNOWN_FUNCTION;
      functionName = typeName ? `${typeName}.${methodName}` : methodName;
    }

    let filename = normalizeStackTracePath(lineMatch[2]);
    const isNative = lineMatch[5] === "native";

    if (!filename && lineMatch[5] && !isNative) {
      filename = lineMatch[5];
    }

    const decoded = filename ? safeDecodeURI(filename) : undefined;
    return {
      colno: parseIntOrUndefined(lineMatch[4]),
      filename: decoded ?? filename,
      function: functionName,
      inApp: filenameIsInApp(filename ?? "", isNative),
      lineno: parseIntOrUndefined(lineMatch[3]),
    };
  }

  if (FILENAME_MATCH.test(line)) {
    return { filename: line };
  }

  return undefined;
}

/**
 * Whether a frame's path is the app's own code: an absolute path, a relative
 * one, or a URL, and not inside `node_modules`. Node's own modules
 * (`node:internal/...`), Electron's (`electron/js2c/...`) and native frames
 * are not.
 */
function filenameIsInApp(filename: string, isNative = false): boolean {
  const isInternal =
    isNative ||
    (filename &&
      !filename.startsWith("/") &&
      !/^[A-Z]:/.test(filename) &&
      !filename.startsWith(".") &&
      !/^[a-zA-Z]([a-zA-Z0-9.\-+])*:\/\//.test(filename));

  return (
    !isInternal &&
    filename !== "" &&
    !filename.includes("node_modules/") &&
    !filename.includes("node_modules\\")
  );
}

/** A path without `file://`, and a Windows one without the slash before its drive. */
function normalizeStackTracePath(path: string | undefined): string | undefined {
  let filename = path?.startsWith("file://") ? path.slice(7) : path;
  if (filename && /\/[A-Z]:/.test(filename)) {
    filename = filename.slice(1);
  }
  return filename;
}

function parseIntOrUndefined(input: string | undefined): number | undefined {
  return Number.parseInt(input ?? "", 10) || undefined;
}

function safeDecodeURI(filename: string): string | undefined {
  try {
    return decodeURI(filename);
  } catch {
    return undefined;
  }
}
