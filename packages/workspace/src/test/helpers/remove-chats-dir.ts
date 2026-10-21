import fs from "node:fs/promises";

/**
 * Removes a test's temp folder. The retries give a subprocess the test killed
 * time to exit and let go of its folder, which it does after the kill returns
 * on Windows.
 */
export async function removeChatsDir(dir: string): Promise<void> {
  await fs.rm(dir, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 100,
  });
}
