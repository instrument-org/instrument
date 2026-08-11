import { resetStudioModals } from "@/client/atoms/studio-modal";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { installWindowStubs } from "./window-stubs";

// Loaded only by the `dom` project (see `vitest.config.ts`), on top of the
// shared node setup.

// Unmounts anything still rendered, so one test's tree cannot be found by the
// next one's queries.
afterEach(cleanup);

// The app-wide modal slot lives on the default store, which no `cleanup` can
// reach: a test that opened a modal would otherwise leave it open for the next
// one, where it reads as a modal already blocking.
afterEach(resetStudioModals);

// jsdom has no layout engine and so no ResizeObserver. A component that measures
// itself would throw on construction here, which is a harsher failure than the
// blindness it stands for: this stub observes nothing and reports nothing, so
// such a component renders and anything it derives from a measurement stays at
// its pre-measurement value. Assert on a measured result in the browser project.
Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  value: class {
    disconnect() {
      // Nothing is observed, so nothing has to be released.
    }
    observe() {
      // No layout to report on.
    }
    unobserve() {
      // See `observe`.
    }
  },
});

// Same story for IntersectionObserver, which anything deferring work until it
// is scrolled near uses. Nothing is ever reported as intersecting, so such a
// component renders whatever it draws before it comes into view -- which is the
// honest answer in a document that has no view.
Object.defineProperty(window, "IntersectionObserver", {
  configurable: true,
  value: class {
    disconnect() {
      // Nothing is observed, so nothing has to be released.
    }
    observe() {
      // No viewport for anything to come into.
    }
    takeRecords() {
      return [];
    }
    unobserve() {
      // See `observe`.
    }
  },
});

installWindowStubs();
