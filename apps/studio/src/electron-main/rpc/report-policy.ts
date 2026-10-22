import { isExpectedNetworkError } from "@instrument-org/shared";
import { ORPCError, ValidationError } from "@orpc/server";

/**
 * What each RPC error code means for reporting, for every procedure in Studio's
 * router and the workspace router it mounts. A code is `expected` when it is
 * part of the procedure's contract: an answer the caller is built to show (a
 * name already taken, a file gone, signed out, nothing to undo). It is a
 * `fault` when it wraps a failure nobody planned for, which is worth a look.
 *
 * `report-policy.test.ts` fails when a procedure throws a code missing here,
 * so a new code is classified when it is added rather than reported by default.
 */
export const RPC_ERROR_CODES = {
  // Studio's base map.
  API_ERROR: "fault",
  NOT_FOUND: "expected",
  UNAUTHORIZED: "expected",

  // The workspace's base map, which `toORPCError` maps typed errors onto.
  FILE_SYSTEM_ERROR: "fault",
  GATEWAY_FETCH_ERROR: "fault",
  INVALID_INPUT: "expected",
  PARSE_ERROR: "fault",
  STORAGE_ERROR: "fault",
  UNKNOWN: "fault",

  // Declared by one procedure, or thrown by name.
  BAD_REQUEST: "expected",
  BROWSER_OPEN_FAILED: "fault",
  // A drop or paste the planner refused (a folder into itself, a clash with
  // no answer, a Replace it may not make), which the Finder shows as said.
  CANNOT_PLACE: "expected",
  CANNOT_TRASH: "fault",
  CANNOT_UNDO: "expected",
  CANNOT_WRITE: "fault",
  CONFLICT: "expected",
  ERROR_OPENING_FILE: "expected",
  FETCH_ERROR: "fault",
  FETCH_FAILED: "fault",
  FILE_NOT_FOUND: "expected",
  // macOS keeping the app out of a folder, which the permissions UI explains,
  // or the app keeping its own data out of the person's editors.
  FORBIDDEN: "expected",
  INVALID_URL: "expected",
  NAME_INVALID: "expected",
  NAME_IN_USE: "expected",
  NOT_A_FOLDER: "expected",
  NOTHING_TO_UNDO: "expected",
  NOT_UTF8: "expected",
  UNSUPPORTED_PLATFORM: "expected",
  UNSUPPORTED_TYPE: "expected",
  WINDOWS_PROTECTION: "expected",

  // oRPC's own: a handler that threw something other than an ORPCError, or
  // returned output its schema refuses.
  INTERNAL_SERVER_ERROR: "fault",
} as const satisfies Record<string, "expected" | "fault">;

function isClassifiedCode(code: string): code is keyof typeof RPC_ERROR_CODES {
  return Object.hasOwn(RPC_ERROR_CODES, code);
}

/**
 * Whether an error an RPC procedure threw is a fault to record. This is the
 * one place that decides it for every procedure; the interceptor in
 * `initialize.ts` records what this says to, and a route throws without
 * recording anything itself.
 *
 * An expected code is never recorded. A fault is, unless what it wraps is the
 * person's network (offline, DNS, a timeout) or a platform API route that
 * failed on the server, which reports its own errors. A code missing from the
 * table, and any error that is not an ORPCError, is a fault.
 */
export function isReportableRPCError(error: unknown): boolean {
  if (isExpectedNetworkError(error)) {
    return false;
  }
  if (!(error instanceof ORPCError)) {
    return true;
  }
  // Input oRPC's own schema check refused came from the renderer, which built
  // it: a bug on our side, though it shares BAD_REQUEST with a refused name.
  if (error.code === "BAD_REQUEST" && error.cause instanceof ValidationError) {
    return true;
  }
  if (
    error.code === "API_ERROR" &&
    error.cause instanceof ORPCError &&
    error.cause.status >= 500
  ) {
    return false;
  }
  const code: unknown = error.code;
  if (typeof code !== "string" || !isClassifiedCode(code)) {
    return true;
  }
  return RPC_ERROR_CODES[code] === "fault";
}
