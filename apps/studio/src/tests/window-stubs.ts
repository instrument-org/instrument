/**
 * The preload bridge, pinned to one machine's answers.
 *
 * Every `isMacOS()`-style check and every path shortened to `~` reads through
 * here, so a component that renders a chord or a home-relative path has to be
 * given a fixed platform and home directory or it follows whatever machine the
 * suite runs on. Both projects that touch the DOM install these, because a
 * measured test in a real browser is no less host-dependent than a jsdom one.
 */
export function installWindowStubs() {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { process: { platform: "darwin" } },
  });

  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      getFilePath: (file: File) => file.name,
      homeDir: "/Users/sam",
    },
  });
}
