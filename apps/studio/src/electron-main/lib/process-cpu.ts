import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import { app, powerMonitor, webContents } from "electron";

const log = createScopedLogger("processCpu");

/** How often every process's CPU is read; each read covers the time since the last. */
const READ_MS = 60_000;
/** Percent of one core a process has to stay at or above to count as hot. */
const HOT_PERCENT = 15;
/** Consecutive hot reads before an episode is logged. */
const HOT_READS = 3;
/** Episodes logged per launch before the rest are only counted. */
export const MAX_REPORTS = 20;

export type CpuSample = {
  cpu: number;
  pid: number;
  /** Electron's process type: Browser, GPU, Tab, Utility. */
  type: string;
  /** A utility process's service, such as `network.mojom.NetworkService`. */
  serviceName?: string;
};

type CpuLog = Pick<typeof log, "info" | "warn">;

type Episode = {
  hotReads: number[];
  label: string;
  logged: boolean;
  startedAt: number;
};

/**
 * The bookkeeping behind `watchProcessCpu`, apart from Electron so it can be
 * driven read by read. `labelOf` is asked once, when an episode is logged.
 */
export function createCpuWatch(options: {
  labelOf: (sample: CpuSample) => string;
  log: CpuLog;
}) {
  const episodes = new Map<number, Episode>();
  let reports = 0;
  let suppressed = false;

  const end = (episode: Episode, at: number) => {
    if (!episode.logged) {
      return;
    }
    const total = episode.hotReads.reduce((sum, cpu) => sum + cpu, 0);
    options.log.info(
      `Sustained CPU ended: ${episode.label} after ${minutes(at - episode.startedAt)}, average ${Math.round(total / episode.hotReads.length)}%, peak ${Math.round(Math.max(...episode.hotReads))}%`,
    );
  };

  return {
    observe(samples: readonly CpuSample[], at: number) {
      const gpu = samples.find((sample) => sample.type === "GPU");
      const seen = new Set<number>();
      for (const sample of samples) {
        seen.add(sample.pid);
        const episode = episodes.get(sample.pid);
        if (sample.cpu < HOT_PERCENT) {
          if (episode) {
            end(episode, at);
            episodes.delete(sample.pid);
          }
          continue;
        }
        if (!episode) {
          episodes.set(sample.pid, {
            hotReads: [sample.cpu],
            label: "",
            logged: false,
            // The first hot read covers the minute before it.
            startedAt: at - READ_MS,
          });
          continue;
        }
        episode.hotReads.push(sample.cpu);
        if (episode.logged || episode.hotReads.length < HOT_READS) {
          continue;
        }
        if (reports >= MAX_REPORTS) {
          if (!suppressed) {
            suppressed = true;
            options.log.warn(
              "Sustained CPU: further reports suppressed until the next launch",
            );
          }
          continue;
        }
        reports += 1;
        episode.logged = true;
        episode.label = options.labelOf(sample);
        const gpuNote =
          gpu && sample.type !== "GPU"
            ? `; GPU process at ${Math.round(gpu.cpu)}%`
            : "";
        options.log.warn(
          `Sustained CPU: ${episode.label} at ${Math.round(sample.cpu)}% for ${minutes(at - episode.startedAt)}${gpuNote}`,
        );
      }
      // A process that went away ends its episode.
      for (const [pid, episode] of episodes) {
        if (!seen.has(pid)) {
          end(episode, at);
          episodes.delete(pid);
        }
      }
    },
  };
}

function minutes(ms: number) {
  return `${Math.max(1, Math.round(ms / 60_000))} min`;
}

/**
 * What a process is, for the log: its type, and for a renderer what it draws,
 * the app window or a browser tab named by its site's host alone, since these
 * logs go out in problem reports and a path or query can be private.
 */
function describeProcess(sample: CpuSample): string {
  if (sample.type === "GPU") {
    return "GPU process";
  }
  if (sample.type === "Browser") {
    return "main process";
  }
  if (sample.type === "Utility") {
    return `utility process (${sample.serviceName ?? "unknown"})`;
  }
  if (sample.type !== "Tab") {
    return `${sample.type} process`;
  }
  const hosts = new Set<string>();
  let isAppWindow = false;
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed() || contents.getOSProcessId() !== sample.pid) {
      continue;
    }
    if (contents.getType() === "webview") {
      hosts.add(hostOf(contents.getURL()));
    } else if (contents.getType() === "window") {
      isAppWindow = true;
    }
  }
  if (isAppWindow) {
    return "app window renderer";
  }
  if (hosts.size > 0) {
    return `browser tab renderer (${[...hosts].slice(0, 3).join(", ")})`;
  }
  return "renderer";
}

function hostOf(url: string) {
  try {
    return new URL(url).host || new URL(url).protocol.replace(":", "");
  } catch {
    return "unknown";
  }
}

/**
 * Logs a warning when any of the app's processes stays at `HOT_PERCENT` CPU
 * or more for `HOT_READS` minutes running, and a line when it settles, naming
 * the process and, for a page, the site it shows. One line per episode and
 * `MAX_REPORTS` episodes per launch, so a page that never settles costs two
 * lines rather than one a minute. A sleeping computer reads nothing.
 */
export function watchProcessCpu() {
  const watch = createCpuWatch({ labelOf: describeProcess, log });
  let isSuspended = false;
  powerMonitor.on("suspend", () => {
    isSuspended = true;
  });
  powerMonitor.on("resume", () => {
    isSuspended = false;
    // The first read after waking covers the sleep; take it and drop it.
    app.getAppMetrics();
  });
  const timer = setInterval(() => {
    if (isSuspended) {
      return;
    }
    watch.observe(
      app.getAppMetrics().map((metric) => ({
        cpu: metric.cpu.percentCPUUsage,
        pid: metric.pid,
        serviceName: metric.serviceName,
        type: metric.type,
      })),
      Date.now(),
    );
  }, READ_MS);
  timer.unref();
}
