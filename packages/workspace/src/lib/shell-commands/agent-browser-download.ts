import type { Protocol } from "devtools-protocol";

import fs from "node:fs/promises";
import path from "node:path";

import { type BrowserConfig, type BrowserTargetId } from "../../types";

/** What a run of the CLI, or a command answered in its place, gives back. */
interface CommandOutput {
  exitCode: number | undefined;
  stderr: string;
  stdout: string;
}

/** How long after the click the download may take to begin. */
const DOWNLOAD_BEGIN_TIMEOUT_MS = 30_000;

/** How long a download that began may take to finish. */
const DOWNLOAD_FINISH_TIMEOUT_MS = 5 * 60_000;

/**
 * `download <selector> <path>` in a tab of the app's browser, which the CLI
 * refuses over a CDP connection since the endpoint names the saved file.
 * Here the app names it: the tab is told to save its next download at
 * `savePath` (`Browser.setDownloadBehavior` with the app's own `fileName`),
 * `click` presses the element through the CLI, and the tab's events say
 * when the file is whole and marked. The CLI's own words on success and
 * failure, `✓ Download saved to <path>` and `✗ <why>`, name the file as the
 * agent's shell does (`shownPath`). Whatever ends the wait other than the
 * download finishing takes the authorization back, so the person's next
 * click in the tab is theirs.
 */
export async function downloadInTab({
  browser,
  click,
  json,
  savePath,
  shownPath,
  signal,
  targetId,
  timeouts = {
    beginMs: DOWNLOAD_BEGIN_TIMEOUT_MS,
    finishMs: DOWNLOAD_FINISH_TIMEOUT_MS,
  },
}: {
  browser: Pick<BrowserConfig, "sendCommand" | "subscribeEvents">;
  /** Presses the element that starts the download. */
  click: () => Promise<CommandOutput>;
  /** Whether the agent asked for the CLI's `--json` output. */
  json: boolean;
  /** Where the file goes, as this computer names it. */
  savePath: string;
  /** Where the file goes, as the agent's shell names it. */
  shownPath: string;
  signal?: AbortSignal;
  targetId: BrowserTargetId;
  timeouts?: { beginMs: number; finishMs: number };
}): Promise<CommandOutput> {
  const fail = (error: string): CommandOutput =>
    json
      ? {
          exitCode: 1,
          stderr: "",
          stdout: `${JSON.stringify({ data: null, error, success: false })}\n`,
        }
      : { exitCode: 1, stderr: `✗ ${error}\n`, stdout: "" };
  const download = watchDownload(browser, targetId);
  let settled = false;
  try {
    try {
      await fs.mkdir(path.dirname(savePath), { recursive: true });
    } catch (error) {
      return fail(`Failed to create download directory: ${String(error)}`);
    }
    const behavior: Protocol.Browser.SetDownloadBehaviorRequest & {
      fileName: string;
    } = {
      behavior: "allow",
      downloadPath: path.dirname(savePath),
      eventsEnabled: true,
      fileName: path.basename(savePath),
    };
    await browser.sendCommand(
      targetId,
      "Browser.setDownloadBehavior",
      behavior,
    );
    const clicked = await click();
    if (clicked.exitCode !== 0) {
      return clicked;
    }
    const ended = await download.ended(timeouts, signal);
    // A download that began took the authorization with it, and the app
    // drops it once the download ends.
    settled =
      ended.kind === "canceled" ||
      ended.kind === "completed" ||
      ended.kind === "unfinished";
    switch (ended.kind) {
      case "canceled": {
        return fail("Download was canceled");
      }
      case "closed": {
        return fail("The tab closed before the download finished");
      }
      case "completed": {
        break;
      }
      case "never-began": {
        return fail(
          `No download began within ${String(timeouts.beginMs / 1000)}s of the click`,
        );
      }
      case "stopped": {
        return fail("Stopped before the download finished");
      }
      case "unfinished": {
        return fail(
          `The download was still running after ${String(timeouts.finishMs / 1000)}s; it is saved to ${shownPath} once it finishes`,
        );
      }
    }
    const saved = await fs.stat(savePath).then(
      (stat) => stat.isFile(),
      () => false,
    );
    if (!saved) {
      return fail(`Download completed but no file is at ${shownPath}`);
    }
    return json
      ? {
          exitCode: 0,
          stderr: "",
          stdout: `${JSON.stringify({ data: { path: shownPath }, error: null, success: true })}\n`,
        }
      : {
          exitCode: 0,
          stderr: "",
          stdout: `✓ Download saved to ${shownPath}\n`,
        };
  } finally {
    download.stop();
    if (!settled) {
      await browser
        .sendCommand(targetId, "Browser.setDownloadBehavior", {
          behavior: "default",
        })
        .catch(() => undefined);
    }
  }
}

type DownloadEnd =
  | { kind: "canceled" }
  | { kind: "closed" }
  | { kind: "completed" }
  | { kind: "never-began" }
  | { kind: "stopped" }
  | { kind: "unfinished" };

/**
 * Follows the first download the tab begins from now on, by the GUID its
 * `Page.downloadWillBegin` names, to the `Page.downloadProgress` that ends
 * it.
 */
function watchDownload(
  browser: Pick<BrowserConfig, "subscribeEvents">,
  targetId: BrowserTargetId,
) {
  let guid: string | undefined;
  let end: DownloadEnd | undefined;
  const waiters = new Set<() => void>();
  const settle = (to: DownloadEnd) => {
    end ??= to;
    for (const wake of waiters) {
      wake();
    }
  };
  const began = () => {
    for (const wake of waiters) {
      wake();
    }
  };
  const stop = browser.subscribeEvents(
    targetId,
    () => {
      settle({ kind: "closed" });
    },
    (method, params, frameSession) => {
      if (frameSession !== undefined) {
        return;
      }
      if (method === "Page.downloadWillBegin" && guid === undefined) {
        // The app's own event, so its shape is the protocol's.
        guid = (params as Protocol.Page.DownloadWillBeginEvent).guid;
        began();
        return;
      }
      if (method !== "Page.downloadProgress" || guid === undefined) {
        return;
      }
      const progress = params as Protocol.Page.DownloadProgressEvent;
      if (progress.guid !== guid) {
        return;
      }
      if (progress.state === "completed") {
        settle({ kind: "completed" });
      } else if (progress.state === "canceled") {
        settle({ kind: "canceled" });
      }
    },
  );

  // Resolves when the download ends, or `kind` when `ms` pass first or the
  // wait is stopped. Wakes early when the download begins, for the caller to
  // start the next phase's clock.
  const until = (ms: number, kind: DownloadEnd, signal?: AbortSignal) =>
    new Promise<DownloadEnd | "began">((resolve) => {
      const startedWith = guid;
      const done = (value: DownloadEnd | "began") => {
        clearTimeout(timer);
        waiters.delete(wake);
        signal?.removeEventListener("abort", aborted);
        resolve(value);
      };
      const wake = () => {
        if (end !== undefined) {
          done(end);
        } else if (startedWith === undefined && guid !== undefined) {
          done("began");
        }
      };
      const aborted = () => {
        done({ kind: "stopped" });
      };
      const timer = setTimeout(() => {
        done(kind);
      }, ms);
      waiters.add(wake);
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) {
        aborted();
        return;
      }
      wake();
    });

  return {
    async ended(
      { beginMs, finishMs }: { beginMs: number; finishMs: number },
      signal?: AbortSignal,
    ): Promise<DownloadEnd> {
      const first =
        guid === undefined && end === undefined
          ? await until(beginMs, { kind: "never-began" }, signal)
          : "began";
      if (first !== "began") {
        return first;
      }
      const last = await until(finishMs, { kind: "unfinished" }, signal);
      return last === "began" ? { kind: "unfinished" } : last;
    },
    stop,
  };
}

/**
 * Where `download` saves a file named by a bare name, with no folder in it:
 * the work folder's downloads folder, as the guide promises. A path with a
 * folder in it is the shell's to resolve, and stays as given.
 */
export function downloadsFolderPath(
  named: string,
  downloadsDir: string,
): string {
  const bare =
    named !== "" &&
    named !== "." &&
    named !== ".." &&
    !named.includes("/") &&
    !named.includes("\\");
  return bare ? path.posix.join(downloadsDir, named) : named;
}
