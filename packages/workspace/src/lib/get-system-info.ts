import os from "node:os";

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

/**
 * Names the user's computer, for deliverables and instructions written for
 * them to run. The raw platform and release stay alongside the familiar name
 * so version-specific advice still has something to go on.
 */
export function getSystemInfo() {
  const platform = os.platform();
  const name = PLATFORM_NAMES[platform];
  const detail = `${platform} ${os.release()}`;

  return name === undefined ? detail : `${name} (${detail})`;
}
