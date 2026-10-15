/**
 * The two short tones dictation plays, so someone knows when to start
 * talking and that the mic has stopped: rising as it starts listening,
 * falling as it stops. Synthesized rather than shipped as files, quiet, and
 * each a pair of soft sine notes.
 */
const CUES = {
  start: [659.25, 987.77],
  stop: [987.77, 659.25],
} as const;

const NOTE_S = 0.07;
const GAP_S = 0.015;
const VOLUME = 0.06;

let context: AudioContext | undefined;

export function playDictationCue(cue: keyof typeof CUES) {
  try {
    context ??= new AudioContext();
    const now = context.currentTime;
    CUES[cue].forEach((frequency, index) => {
      if (!context) {
        return;
      }
      const at = now + index * (NOTE_S + GAP_S);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(VOLUME, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_S);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + NOTE_S);
    });
  } catch {
    // A cue that can't play is no reason to stop a dictation.
  }
}
