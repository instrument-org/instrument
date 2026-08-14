/**
 * Stands in for everything the preload puts on `window` when the renderer
 * boots inside Electron. Must run before `@/client/main` is imported, which
 * reads `window.api.windowType` at module scope.
 */
export function installStubs() {
  const params = new URLSearchParams(window.location.search);
  const windowType =
    params.get("windowType") === "onboarding" ? "onboarding" : "main";

  window.api = {
    // The real one maps a dropped File to an absolute host path via webUtils.
    // A browser never learns that path, so drops degrade to the file name.
    // `rendererLog` is left off entirely: it is optional, and forwarding to a
    // main-process log has no meaning here.
    getFilePath: (file: File) => file.name,
    // A browser has no home directory to report, so displayed paths keep
    // whatever the fixtures spell.
    homeDir: "/Users/web",
    windowType,
  };

  // `@electron-toolkit/preload`'s surface. `isMacOS`/`isLinux` in
  // `client/lib/utils.ts` read `process.platform` during the first toolbar
  // render, so this has to be populated rather than an empty object.
  const platform = navigator.userAgent.includes("Mac")
    ? "darwin"
    : navigator.userAgent.includes("Win")
      ? "win32"
      : "linux";

  // Cast because this is deliberately a sliver of `ElectronAPI`: the renderer
  // reads `process.platform` and nothing else, and standing up ipcRenderer /
  // webFrame / webUtils stubs would invent behavior no caller wants.
  window.electron = {
    process: { env: {}, platform, versions: {} },
  } as unknown as Window["electron"];
}
