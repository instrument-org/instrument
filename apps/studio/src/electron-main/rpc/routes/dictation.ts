import { transcribeDictation } from "@/electron-main/platform-api/dictation";
import {
  feedDictation,
  finishDictation,
  listenForDictation,
} from "@/electron-main/platform-api/dictation-stream";
import { holdDictation } from "@/electron-main/lib/dictation-in-progress";
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

/**
 * Opens a live stream for a take and yields what it hears, closing it when
 * the caller stops listening. Its first event is `open`, with the id the
 * take's audio goes to, or `unavailable`.
 */
const listen = base
  .input(z.object({ surface: DictationSurfaceSchema }))
  .handler(async function* ({ input, signal }) {
    yield* listenForDictation({
      language: getMachinePreferences().get("dictationLanguage"),
      signal,
      surface: input.surface,
    });
  });

/**
 * Held open for as long as a take records, so quitting can ask first. It
 * yields nothing; the caller ends it by aborting, and a window that goes away
 * ends it too.
 */
const recording = base.handler(async function* ({ signal }) {
  await holdDictation(signal);
  yield* [];
});

/** The next stretch of a live take's audio, as the recorder wrote it. */
const feed = base
  .input(z.object({ chunk: z.instanceof(Blob), id: z.string() }))
  .handler(({ input }) => {
    feedDictation(input.id, input.chunk);
  });

/** Stop for a live take: the stream settles its last words and ends. */
const finish = base.input(z.object({ id: z.string() })).handler(({ input }) => {
  finishDictation(input.id);
});

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

/** Whether dictation plays a sound as it starts and stops. */
const setSounds = base
  .input(z.object({ on: z.boolean() }))
  .handler(({ input }) => {
    getMachinePreferences().set("dictationSounds", input.on);
  });

export const dictation = {
  feed,
  finish,
  listen,
  recording,
  setLanguage,
  setMicrophone,
  setSounds,
  transcribe,
};
