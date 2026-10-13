import { transcribeDictation } from "@/electron-main/platform-api/dictation";
import { base } from "@/electron-main/rpc/base";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import {
  DictationLanguageSchema,
  DictationMicrophoneSchema,
  DictationSurfaceSchema,
} from "@/shared/dictation";
import { z } from "zod";

/**
 * Turns one recording into text. The recording arrives whole, as a Blob,
 * which the RPC link carries as binary rather than as JSON. The language is
 * the one picked in Settings, read here so the renderer never has to.
 */
const transcribe = base
  .input(
    z.object({
      audio: z.instanceof(Blob),
      surface: DictationSurfaceSchema,
    }),
  )
  .handler(({ input, signal }) =>
    transcribeDictation({
      audio: input.audio,
      language: getMachinePreferences().get("dictationLanguage"),
      signal,
      surface: input.surface,
    }),
  );

/** Picks the microphone dictation records from; none means the system default. */
const setMicrophone = base
  .input(z.object({ microphone: DictationMicrophoneSchema.optional() }))
  .handler(({ input }) => {
    const store = getMachinePreferences();
    if (input.microphone === undefined) {
      store.delete("dictationMicrophone");
    } else {
      store.set("dictationMicrophone", input.microphone);
    }
  });

/** Picks the language dictation listens for; none means detect it. */
const setLanguage = base
  .input(z.object({ language: DictationLanguageSchema.optional() }))
  .handler(({ input }) => {
    const store = getMachinePreferences();
    if (input.language === undefined) {
      store.delete("dictationLanguage");
    } else {
      store.set("dictationLanguage", input.language);
    }
  });

export const dictation = { setLanguage, setMicrophone, transcribe };
