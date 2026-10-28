import { execFile } from "node:child_process";

/**
 * Where Windows records each app's use of the microphone and the camera.
 * Every app that used one has a key under these, and its `LastUsedTimeStop`
 * is 0 while it is still using it.
 */
const CONSENT_STORE =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore";
const DEVICES = ["microphone", "webcam"] as const;

/**
 * Whether any app is using the microphone or the camera right now, for a
 * restart that must not cut off a call. Windows says so in its consent store;
 * macOS has no way to ask without native code, so there the answer is always
 * idle and the check is skipped.
 */
export async function readCaptureInUse(): Promise<"busy" | "idle"> {
  if (process.platform !== "win32") {
    return "idle";
  }
  const outputs = await Promise.all(
    DEVICES.map((device) =>
      queryRegistry([
        "query",
        `${CONSENT_STORE}\\${device}`,
        "/s",
        "/v",
        "LastUsedTimeStop",
      ]),
    ),
  );
  return outputs.some(captureInUseFromRegistry) ? "busy" : "idle";
}

/** Whether `reg query … /s /v LastUsedTimeStop` names an app still in use. */
export function captureInUseFromRegistry(output: string): boolean {
  return output
    .split(/\r?\n/)
    .some((line) => /^\s*LastUsedTimeStop\s+REG_QWORD\s+0x0+\s*$/i.test(line));
}

function queryRegistry(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("reg", args, { windowsHide: true }, (error, stdout) => {
      // `reg` exits 1 when a device has never been used, which means
      // nothing is using it.
      if (error && error.code !== 1) {
        reject(new Error("Could not read the registry", { cause: error }));
        return;
      }
      resolve(stdout);
    });
  });
}
