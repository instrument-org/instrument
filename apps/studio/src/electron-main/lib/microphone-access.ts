import { app, shell, systemPreferences } from "electron";

/**
 * Where the app stands with the system on the microphone. macOS asks once
 * and keeps a switch per app; Windows has one switch for every desktop app.
 * Linux says nothing worth asking about here, so it is `unsupported`, and a
 * refusal shows up when the recording starts instead.
 *
 * `reopen` is a refusal after System Settings was opened in this run: macOS
 * keeps a running app on the answer it started with, so whether the switch
 * was turned on there shows only after a relaunch.
 */
export type MicrophoneAccess =
  | "denied"
  | "granted"
  | "not-determined"
  | "reopen"
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

let settingsOpened = false;

export function microphoneAccess(): MicrophoneAccess {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return "unsupported";
  }
  if (usesFakeMicrophone()) {
    return "granted";
  }
  const status = systemPreferences.getMediaAccessStatus("microphone");
  if (status === "unknown") {
    return "unsupported";
  }
  return status === "denied" && settingsOpened ? "reopen" : status;
}

/** The system's prompt when nobody has answered it; the standing answer otherwise. */
export async function requestMicrophoneAccess(): Promise<MicrophoneAccess> {
  if (
    process.platform === "darwin" &&
    microphoneAccess() === "not-determined"
  ) {
    await systemPreferences.askForMediaAccess("microphone");
  }
  return microphoneAccess();
}

/** Opens the system's microphone privacy settings, where the app's switch is. */
export async function openMicrophoneSettings(): Promise<{ opened: boolean }> {
  if (process.platform === "darwin") {
    settingsOpened = true;
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    );
    return { opened: true };
  }
  if (process.platform === "win32") {
    await shell.openExternal("ms-settings:privacy-microphone");
    return { opened: true };
  }
  return { opened: false };
}
