import { app } from "electron";

/**
 * What the system hands the app from outside: a file from the Finder, a link
 * in its scheme, another launch (which the single-instance lock routes here),
 * and the app activated. Some come before `ready`, the one that launched the
 * app among them, while the main module loads only after the first window is
 * up, so they are caught from the first lines and kept until it takes them.
 */
export type HandOver =
  | { kind: "activate" }
  | { kind: "file"; path: string }
  | { kind: "link"; url: string }
  | { commandLine: string[]; kind: "secondLaunch" };

const waiting: HandOver[] = [];
let take: ((handOver: HandOver) => void) | undefined;

function handOver(given: HandOver) {
  if (take) {
    take(given);
  } else {
    waiting.push(given);
  }
}

/** Listens for every hand-over, before `ready`. */
export function catchHandOvers() {
  app.on("second-instance", (_event, commandLine) => {
    handOver({ commandLine, kind: "secondLaunch" });
  });
  app.on("open-file", (event, path) => {
    event.preventDefault();
    handOver({ kind: "file", path });
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handOver({ kind: "link", url });
  });
  app.on("activate", () => {
    handOver({ kind: "activate" });
  });
}

/** Hands over what came so far, in order, and everything after as it comes. */
export function takeHandOvers(taker: (handOver: HandOver) => void) {
  take = taker;
  for (const given of waiting.splice(0)) {
    taker(given);
  }
}
