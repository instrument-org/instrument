/**
 * Turns a microphone's loudness into a bar height from 0 to 1 that reads the
 * same in a quiet room and a loud one: against a floor that settles on the
 * room's steady noise and a peak that follows the voice, at least 18 dB
 * apart, so steady noise sits near the bottom and speech moves the bars
 * whether it is whispered or spoken up. The peak sits 6 dB under the top,
 * so even steady loud speech rises and falls rather than filling every bar.
 */
export function createWaveLevel() {
  let floor = -60;
  let peak = -30;
  return (rms: number) => {
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    // The floor drops quickly to a quieter moment and creeps up under steady
    // noise; the peak jumps to a louder one and eases back down.
    floor += (db - floor) * (db < floor ? 0.3 : 0.005);
    peak = Math.max(db > peak ? db : peak - 0.15, floor + 18);
    const level = (db - floor - 3) / (peak + 6 - floor - 3);
    return Math.min(1, Math.max(0, level)) ** 1.5;
  };
}

/** The root mean square of one frame of samples. */
export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return samples.length === 0 ? 0 : Math.sqrt(sum / samples.length);
}
