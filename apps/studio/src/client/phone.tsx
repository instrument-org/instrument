import type { SetupState } from "@/shared/setup";
import type { ElectronAPI } from "@electron-toolkit/preload";

import { type PhoneHost } from "./lib/phone-host";

/**
 * The renderer on a phone or in a browser on the network: the page reads
 * where its host is from its address (`#host=...&token=...`, kept for the
 * session so a reload keeps it), asks the host for what the preload would
 * have read before the first render, stands in for the preload with that,
 * and only then loads the app, so every module that reads `window.api` as it
 * loads finds it there.
 */
const KEY = "instrument.phone";

interface Bootstrap {
  computerFileBase: string;
  homeDir: string;
  platform: string;
  setupState: null | SetupState;
  systemRegion?: string;
  theme: "dark" | "light";
}

function readHost(): PhoneHost | undefined {
  const params = new URLSearchParams(location.hash.slice(1));
  const origin = params.get("host");
  const token = params.get("token");
  if (origin && token) {
    const host = { origin: origin.replace(/\/$/, ""), token };
    sessionStorage.setItem(KEY, JSON.stringify(host));
    history.replaceState(null, "", location.pathname);
    return host;
  }
  const kept = sessionStorage.getItem(KEY);
  if (kept) {
    // Written above, by this page.
    return JSON.parse(kept) as PhoneHost;
  }
  return undefined;
}

async function start() {
  const host = readHost();
  if (!host) {
    document.body.textContent =
      "Open this page from the address Instrument logged, which names the host and its token.";
    return;
  }
  globalThis.__instrumentPhone = host;
  // Over plain HTTP on the network the page is no secure context, which
  // takes `crypto.randomUUID` away (the tab model mints ids with it) while
  // leaving `getRandomValues`; the one is built from the other.
  if (typeof crypto.randomUUID !== "function") {
    crypto.randomUUID = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}` as `${string}-${string}-${string}-${string}-${string}`;
    };
  }
  const answer = await fetch(`${host.origin}/bootstrap`, {
    headers: { authorization: `Bearer ${host.token}` },
  });
  if (!answer.ok) {
    document.body.textContent = `The host refused the page (${String(answer.status)}).`;
    return;
  }
  // The host's own JSON, shaped by `electron-main/phone-host/`.
  const bootstrap = (await answer.json()) as Bootstrap;
  document.documentElement.classList.add(bootstrap.theme);
  // Loaded only now: it reaches the RPC client, which picks its transport
  // by the host set above as it loads.
  const { setComputerFileBase } = await import("./lib/computer-file-url");
  setComputerFileBase(bootstrap.computerFileBase);
  window.api = {
    captureException: () => Promise.resolve(null),
    codeEditorFocus: () => undefined,
    getFilePath: () => "",
    homeDir: bootstrap.homeDir,
    initialSetupState: bootstrap.setupState,
    systemRegion: bootstrap.systemRegion,
    windowType: "app",
  };
  // Only the platform is read from it in the renderer; the rest of the
  // preload's Electron API has no meaning on a phone.
  window.electron = {
    process: { platform: bootstrap.platform },
  } as unknown as ElectronAPI;
  await import("./main");
}

start().catch((error: unknown) => {
  // A failure before React mounts has no boundary to show it, so the page
  // says what it was.
  const pre = document.createElement("pre");
  pre.textContent =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  document.body.append(pre);
});
