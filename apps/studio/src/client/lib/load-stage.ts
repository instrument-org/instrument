/**
 * How far a page's load to a new document has come, from the events Chromium
 * reports for it: `waiting` until the server answers, `committed` once its
 * document has started to arrive, `ready` once that document is parsed and
 * only what it pulls in is left.
 *
 * Chromium also starts and stops loading for a same-document navigation
 * (`history.replaceState`, a fragment) and for a frame loading inside a page
 * that is going nowhere, and Chrome shows no loading UI for either: its
 * progress, spinner and Stop button follow `ShouldShowLoadingUI`, true only
 * for a different-document navigation. Electron fires `did-start-loading`
 * for all of them alike, so those stay `idle` here.
 */
export type LoadStage = "committed" | "idle" | "ready" | "waiting";

export type LoadState = {
  /** Between `did-start-loading` and `did-stop-loading`. */
  loading: boolean;
  stage: LoadStage;
};

export type LoadEvent =
  | { isInPlace: boolean; isMainFrame: boolean; type: "did-start-navigation" }
  | {
      type:
        | "did-navigate"
        | "did-start-loading"
        | "did-stop-loading"
        | "dom-ready";
    };

export const IDLE_LOAD: LoadState = { loading: false, stage: "idle" };

/**
 * The load after `event`. A navigation counts only inside a load under way,
 * since one refused before it loads has no stop to end it; and the later
 * stages move only a load already counted.
 */
export function nextLoad(load: LoadState, event: LoadEvent): LoadState {
  switch (event.type) {
    case "did-navigate": {
      return load.stage === "idle" ? load : { ...load, stage: "committed" };
    }
    case "did-start-loading": {
      return { ...load, loading: true };
    }
    case "did-start-navigation": {
      return load.loading && event.isMainFrame && !event.isInPlace
        ? { ...load, stage: "waiting" }
        : load;
    }
    case "did-stop-loading": {
      return IDLE_LOAD;
    }
    case "dom-ready": {
      return load.stage === "idle" ? load : { ...load, stage: "ready" };
    }
  }
}
