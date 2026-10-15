import { app, shell, systemPreferences } from "electron";

/**
 * Where the app stands with macOS on the microphone. Off macOS the system
 * says nothing worth asking about here, so it is `unsupported`, and a refusal
 * shows up when the recording starts instead.
 */
export type MicrophoneAccess =
  | "denied"
  | "granted"
  | "not-determined"
  | "restricted"
  | "unsupported";

/**
 * A fake capture device (Chromium's `--use-fake-device-for-media-stream`,
 * for driving dictation in a development run) needs no permission, and
 * asking for one would put the system's prompt in front of whoever is at the
 * machine.
 */
function usesFakeMicrophone(): boolean {
  return app.commandLine.hasSwitch("use-fake-device-for-media-stream");
}

export function microphoneAccess(): MicrophoneAccess {
  if (process.platform !== "darwin") {
    return "unsupported";
  }
  if (usesFakeMicrophone()) {
    return "granted";
  }
  const status = systemPreferences.getMediaAccessStatus("microphone");
  return status === "unknown" ? "unsupported" : status;
}

/** The system's prompt when nobody has answered it; the standing answer otherwise. */
export async function requestMicrophoneAccess(): Promise<MicrophoneAccess> {
  if (microphoneAccess() === "not-determined") {
    await systemPreferences.askForMediaAccess("microphone");
  }
  return microphoneAccess();
}

/** Opens the system's microphone privacy settings, where the app's switch is. */
export async function openMicrophoneSettings(): Promise<{ opened: boolean }> {
  if (process.platform !== "darwin") {
    return { opened: false };
  }
  await shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  );
  return { opened: true };
}
