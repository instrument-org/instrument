import { getAppWindows } from "@/electron-main/windows/app-window";
import { logger } from "@/electron-main/lib/electron-logger";
import {
  type InputDevice,
  pickableInputs,
} from "@/shared/dictation-microphone";
import { z } from "zod";

const DevicesSchema = z.array(
  z.object({ deviceId: z.string(), label: z.string() }),
);

/** Runs in a window, which is where the browser lists its devices. */
const LIST_INPUTS = `navigator.mediaDevices.enumerateDevices().then((devices) =>
  devices.filter((device) => device.kind === "audioinput").map(({ deviceId, label }) => ({ deviceId, label })),
)`;

/**
 * The microphones a person could pick, as a window lists them: none while no
 * window is open, and unnamed ones until the computer lets the app use one.
 */
export async function microphones(): Promise<InputDevice[]> {
  const [window] = getAppWindows();
  if (!window || window.webContents.isLoading()) {
    return [];
  }
  try {
    return pickableInputs(
      DevicesSchema.parse(
        await window.webContents.executeJavaScript(LIST_INPUTS),
      ),
    );
  } catch (error) {
    logger.warn("Could not list the microphones", error);
    return [];
  }
}
