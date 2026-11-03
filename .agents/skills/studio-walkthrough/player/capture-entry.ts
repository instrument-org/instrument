// Injected into Studio's renderer: the internal repo's page capture, hosted by
// the page itself. The capture posts to window.parent, which at the top level
// is the window, so this listens for its own batches and hands them to the
// driver through a CDP binding.
import { installCapture } from "@instrument/recorder/capture";

declare global {
  interface Window {
    __walkthroughSink?: (payload: string) => void;
    __walkthrough?: { start(): void; stop(): void; uninstall(): void };
  }
}

const CHANNEL = "instrument-recorder";

if (!window.__walkthrough) {
  const send = (payload: unknown) =>
    window.__walkthroughSink?.(JSON.stringify(payload));
  window.addEventListener("message", (event) => {
    const data = event.data as { channel?: string; kind?: string; events?: unknown; message?: string };
    if (!data || data.channel !== CHANNEL) return;
    if (data.kind === "batch") send({ kind: "batch", events: data.events });
    else if (data.kind === "hello" || data.kind === "stopped" || data.kind === "problem")
      send({ kind: data.kind, message: data.message });
  });
  const uninstall = installCapture({ batchMs: 500, host: location.origin, maskInputs: false });
  const post = (kind: string) => window.postMessage({ channel: CHANNEL, kind }, location.origin);
  window.__walkthrough = { start: () => post("start"), stop: () => post("stop"), uninstall };
}
