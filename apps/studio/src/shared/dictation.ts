import { z } from "zod";

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
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "ja", name: "Japanese" },
  { code: "ru", name: "Russian" },
  { code: "hi", name: "Hindi" },
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
 * whether to ask for a sign-in, keep the recording for a retry, or say when
 * dictation comes back.
 */
export type DictationFailure =
  | { kind: "allowance-reached"; resetsAt?: string }
  | { kind: "canceled" }
  | { kind: "connection" }
  | { kind: "rate-limited" }
  | { kind: "server" }
  | { kind: "signed-out" }
  | { kind: "too-large" };

export type DictationResult =
  | { durationSeconds: number; ok: true; text: string }
  | { failure: DictationFailure; ok: false };
