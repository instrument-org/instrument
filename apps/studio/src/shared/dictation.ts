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
 * whether to ask for a sign-in, keep the recording for a retry, or say when
 * dictation comes back.
 */
export type DictationFailure =
  | { kind: "allowance-reached"; resetsAt?: string }
  | { kind: "canceled" }
  | { kind: "connection" }
  /** The API heard no audio in the recording. */
  | { kind: "no-audio" }
  | { kind: "rate-limited" }
  | { kind: "server" }
  /** The API won't take this recording or language: it isn't worth retrying. */
  | { kind: "rejected" }
  | { kind: "signed-out" }
  | { kind: "too-large" };

export type DictationResult =
  | { durationSeconds: number; ok: true; text: string }
  | { failure: DictationFailure; ok: false };
