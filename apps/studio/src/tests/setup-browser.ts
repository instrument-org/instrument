/**
 * Loaded only by the `browser` project (see `vitest.config.ts`). It shares no
 * setup with the other two: the node setup mocks `electron` and reads a dotenv
 * file, neither of which means anything inside a browser.
 *
 * The stylesheet is part of that. A measured test that renders without the
 * app's CSS is measuring a different app, and every test in this project is a
 * measured one. Loading it here rather than per file also means one Tailwind
 * compile for the whole run.
 */
import "@/client/styles/globals.css";
import { resetStudioModals } from "@/client/atoms/studio-modal";
import { afterEach } from "vitest";

import { installWindowStubs } from "./window-stubs";

// `vitest-browser-react` registers its own `beforeEach(cleanup)`, so unmounting
// is already handled. The app-wide modal slot is not: it lives on the default
// store, which no unmount reaches, so a test that opened a modal would leave it
// open for the next one.
afterEach(resetStudioModals);

installWindowStubs();

// A real browser runs the transitions and keyframes the app declares, and a
// measurement taken while one is mid-flight is a measurement of a frame nobody
// asked about. Both are cut to zero rather than disabled, so anything waiting
// on `transitionend` still gets its event.
//
// This covers CSS only. Animation driven from JavaScript -- the scroller's
// spring, anything stepping a value per frame -- runs at full length, and a
// test that depends on where it lands has to wait for it.
const style = document.createElement("style");
style.textContent = `*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
}`;
document.head.append(style);
