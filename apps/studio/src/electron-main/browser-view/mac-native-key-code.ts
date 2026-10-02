import type { Protocol } from "devtools-protocol";

/**
 * Drop a key event's native key code on macOS.
 *
 * `nativeVirtualKeyCode` is the platform's own numbering, and the client fills
 * it with the Windows virtual key code its layout table carries. The two agree
 * only on Windows: macOS numbers 76 as the keypad's Enter rather than `L`, so
 * the event names a key that its own character disagrees with. Held with
 * Command, that is what matches `About <app>` -- the first item of the first
 * menu, and the only one carrying no key equivalent of its own -- so the chord
 * does nothing it was sent for and the About panel opens over whatever the user
 * is in. Measured: one chord carrying the code opened the panel on the first
 * press, and five without it opened nothing.
 *
 * Blink reads `KeyboardEvent.keyCode` from `windowsVirtualKeyCode`, which is
 * left alone, so the guest still receives the whole chord.
 */
export function withoutMacNativeKeyCode(
  method: string,
  params: unknown,
): unknown {
  if (method !== "Input.dispatchKeyEvent" || process.platform !== "darwin") {
    return params;
  }

  // Cast: params crosses a string-keyed bridge from the out-of-process
  // agent-browser client, so it arrives as unknown like every other command's.
  const event = (params ?? {}) as Protocol.Input.DispatchKeyEventRequest;
  if (event.nativeVirtualKeyCode === undefined) {
    return params;
  }

  const stripped = { ...event };
  delete stripped.nativeVirtualKeyCode;
  return stripped;
}
