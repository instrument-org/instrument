import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { getToken } from "@/electron-main/platform-api/utils";
import {
  type DictationFailure,
  type DictationLanguage,
  type DictationResult,
  type DictationSurface,
} from "@/shared/dictation";
import { z } from "zod";

import { getPlatformApiHeaders } from "./headers";

/**
 * Long enough for a ten-minute recording to upload over a slow connection and
 * come back as text; a request still open past it is treated as lost.
 */
const TRANSCRIBE_TIMEOUT_MS = 180_000;

const TranscriptSchema = z.object({
  durationSeconds: z.number(),
  text: z.string(),
});

/** The API answers in one of two shapes: a typed error, or a plain message. */
const ErrorSchema = z.object({
  error: z.union([
    z.string(),
    z.object({
      code: z.string(),
      resetsAt: z.string().optional(),
    }),
  ]),
});

/**
 * What the last answer said about today's allowance: seconds left, and when
 * it comes back once there are none, for the session it was said to. Held in
 * memory only, so a press of the mic can be told before recording that there
 * is nothing left to spend, and another account signing in starts fresh.
 */
let lastAllowance: {
  remainingSeconds?: number;
  resetsAt?: string;
  token?: null | string;
} = {};

/** Keeps that today's dictation is used up until `resetsAt`. */
export function noteDictationUsedUp(resetsAt: string | undefined) {
  lastAllowance = { remainingSeconds: 0, resetsAt, token: getToken() };
}

function remainingSecondsOf(response: Response): number | undefined {
  const header = response.headers.get("x-dictation-remaining-seconds");
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Whether today's dictation is known to be used up: the last answer left
 * none, and the time it comes back has not passed. Anything less certain
 * lets the recording go ahead, and the API says no if it must.
 */
export function dictationAllowance(now = Date.now()): {
  exhausted: boolean;
  resetsAt?: string;
} {
  const { remainingSeconds, resetsAt, token } = lastAllowance;
  if (token !== getToken()) {
    return { exhausted: false };
  }
  const resets = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt);
  const exhausted =
    remainingSeconds !== undefined &&
    remainingSeconds <= 0 &&
    Number.isFinite(resets) &&
    now < resets;
  return exhausted ? { exhausted, resetsAt } : { exhausted };
}

function failed(failure: DictationFailure): DictationResult {
  return { failure, ok: false };
}

/** What a refused request means for the person, from its status and the typed error body. */
export function dictationFailureOf(
  status: number,
  body: string,
): DictationFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  const error = ErrorSchema.safeParse(parsed).data?.error;
  if (status === 401) {
    return { kind: "signed-out" };
  }
  if (status === 413) {
    return { kind: "too-large" };
  }
  if (status === 429) {
    return typeof error === "object" &&
      error.code === "dictation-allowance-reached"
      ? { kind: "allowance-reached", resetsAt: error.resetsAt }
      : { kind: "rate-limited" };
  }
  if (status === 400 && error === "No audio") {
    return { kind: "no-audio" };
  }
  if (status === 415) {
    return { kind: "unsupported-audio" };
  }
  if (status === 400) {
    return { kind: "rejected" };
  }
  return { kind: "server" };
}

/**
 * Sends one whole recording to the API and returns its text. The renderer
 * cannot reach the API itself, so the recording comes through here, and every
 * way it can fail comes back as a {@link DictationFailure} rather than a throw.
 */
export async function transcribeDictation({
  audio,
  language,
  signal,
  surface,
}: {
  audio: Blob;
  language?: DictationLanguage;
  signal?: AbortSignal;
  surface: DictationSurface;
}): Promise<DictationResult> {
  if (!getToken()) {
    return failed({ kind: "signed-out" });
  }

  const query = language ? `?${new URLSearchParams({ language })}` : "";
  const url = `${platformApiBaseUrl()}/dictation${query}`;
  const timeout = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      body: audio,
      headers: {
        ...getPlatformApiHeaders(),
        "content-type": audio.type || "audio/webm",
        "x-instrument-dictation-surface": surface,
      },
      method: "POST",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    return failed(
      signal?.aborted ? { kind: "canceled" } : { kind: "connection" },
    );
  }

  const body = await response.text().catch(() => "");
  const remainingSeconds = remainingSecondsOf(response);
  if (!response.ok) {
    const failure = dictationFailureOf(response.status, body);
    if (failure.kind === "allowance-reached") {
      lastAllowance = {
        remainingSeconds: remainingSeconds ?? 0,
        resetsAt: failure.resetsAt,
        token: getToken(),
      };
      return failed({ ...failure, remainingSeconds: remainingSeconds ?? 0 });
    }
    return failed(failure);
  }
  if (remainingSeconds !== undefined) {
    lastAllowance = { remainingSeconds, token: getToken() };
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return failed({ kind: "server" });
  }
  const parsed = TranscriptSchema.safeParse(json);
  if (!parsed.success) {
    return failed({ kind: "server" });
  }
  return {
    ...parsed.data,
    ok: true,
    ...(remainingSeconds !== undefined && { remainingSeconds }),
  };
}
