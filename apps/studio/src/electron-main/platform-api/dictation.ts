import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { getToken } from "@/electron-main/platform-api/utils";
import { PlanRefusalResponseSchema } from "@/shared/billing";
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

const TranscriptSchema = z.object({ text: z.string() });

/** A refusal said in a plain message rather than a typed error. */
const MessageSchema = z.object({ error: z.string() });

function failed(failure: DictationFailure): DictationResult {
  return { failure, ok: false };
}

/**
 * What a refused request means for the person, from its status and body.
 * Billing's refusals are read with the same schema search reads them with.
 */
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
  const refusal = PlanRefusalResponseSchema.safeParse(parsed).data?.error;
  if (refusal) {
    return { kind: "billing-refused", refusal };
  }
  const message = MessageSchema.safeParse(parsed).data?.error;
  if (status === 401) {
    return { kind: "signed-out" };
  }
  if (status === 413) {
    return { kind: "too-large" };
  }
  if (status === 429) {
    return { kind: "rate-limited" };
  }
  if (status === 400 && message === "No audio") {
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
  if (!response.ok) {
    return failed(dictationFailureOf(response.status, body));
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
  return { ok: true, text: parsed.data.text };
}
