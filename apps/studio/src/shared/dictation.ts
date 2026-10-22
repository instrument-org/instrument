import { z } from "zod";

import { type PlanRefusal } from "./billing";

/**
 * Where a dictation was made, sent with it so the API can say which surfaces
 * people dictate into.
 */
export const DictationSurfaceSchema = z.enum([
  "composer",
  "question-note",
  "report",
  "topic-instructions",
]);
export type DictationSurface = z.output<typeof DictationSurfaceSchema>;

/**
 * The languages someone can pick for dictation, by the code the API takes.
 * Leaving it unpicked lets the API detect the language instead.
 */
export const DICTATION_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "es-419", name: "Spanish (Latin America)" },
  { code: "fr", name: "French" },
  { code: "fr-CA", name: "French (Canada)" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "ja", name: "Japanese" },
  { code: "hi", name: "Hindi" },
  { code: "ru", name: "Russian" },
  { code: "multi", name: "Several languages" },
] as const;

export const DictationLanguageSchema = z.enum(
  DICTATION_LANGUAGES.map((language) => language.code),
);
export type DictationLanguage = z.output<typeof DictationLanguageSchema>;

/**
 * The microphone picked in Settings. A device's id can change between
 * sessions, so its label is kept too, to find it again by name.
 */
export const DictationMicrophoneSchema = z.object({
  deviceId: z.string(),
  label: z.string(),
});
export type DictationMicrophone = z.output<typeof DictationMicrophoneSchema>;

/**
 * Why a recording didn't come back as text, in the terms the app acts on:
 * whether to ask for a sign-in, keep the recording for a retry, or say what
 * billing refused it for.
 */
export type DictationFailure =
  /** Billing refused it: no plan, or a usage window spent. */
  | { kind: "billing-refused"; refusal: PlanRefusal }
  | { kind: "canceled" }
  | { kind: "connection" }
  /** The API heard no audio in the recording. */
  | { kind: "no-audio" }
  | { kind: "rate-limited" }
  | { kind: "server" }
  /** The API won't take this recording or language: it isn't worth retrying. */
  | { kind: "rejected" }
  | { kind: "signed-out" }
  | { kind: "too-large" }
  /** The API can't read the recording's audio format. */
  | { kind: "unsupported-audio" };

export type DictationResult =
  | { ok: true; text: string }
  | { failure: DictationFailure; ok: false };

/**
 * What a live dictation stream reports while the take is recorded. `open`
 * comes first, with the id the take's audio is fed to; `unavailable` instead
 * when the stream could not open, so the take is uploaded at Stop. `text` is
 * the words so far: an interim one replaces the last interim, a final one
 * settles. `end` comes once, after Stop, saying whether the stream heard the
 * whole take, and why it ended: Stop, a billing limit reached mid-take, or a
 * failure. `lost` when it went away without one.
 */
export type DictationStreamEvent =
  | { failure: DictationFailure; type: "unavailable" }
  | { final: boolean; text: string; type: "text" }
  | { id: string; type: "open" }
  | {
      complete: boolean;
      reason: "failed" | "limit" | "stopped";
      type: "end";
    }
  | { type: "lost" };
