/**
 * The one place that decides when the app may open a window, and what an
 * outside request does while it may not.
 *
 * A launch is booting until it restores the windows the workspace was left
 * with (`openWindows`), or refused when the workspace will not open, which
 * holds for the whole run. Electron hands requests over from the first line
 * of the main module on, well before boot gets that far: the link or file a
 * launch was started with, a second launch, the Dock icon. A window made for
 * one of those would be one more than boot restores, up before the main
 * process answers its page. So until the windows are open every request goes
 * through `receive`: what it asks to see is queued for the window boot opens,
 * and the window it would bring forward or open is left to boot, which puts
 * its windows up taking the focus once a person asked for the app.
 */

/** Something handed to the app from outside it. */
export type LaunchRequest =
  /** A link in this build's scheme. */
  | { kind: "link"; url: string }
  /** Files or folders from the Finder, a drop on the Dock icon, or a launch's arguments. */
  | { kind: "files"; paths: readonly string[] }
  /**
   * The app launched again while it runs, which the single-instance lock
   * routes here: to come forward, a window of its own (the taskbar's New
   * Window task), a link, or files.
   */
  | {
      files: readonly string[];
      kind: "secondLaunch";
      newWindow: boolean;
      url: string | undefined;
    }
  /** The app activated: the Dock icon clicked, and on macOS the launch itself. */
  | { kind: "activate" };

export type LaunchStage = "booting" | "open" | "refused";

/** What a launch does to the app's windows, handed in so a test can stand in for them. */
export type LaunchActions = {
  /** Brings the window in front forward, making one if none is left. */
  comeForward: () => void;
  /** The Dock icon's answer: a held window up, or one back where none is left. */
  activate: () => void;
  /** Brings the refused workspace's window forward. */
  focusRefusal: () => void;
  /** Puts up what a link asks for, queued for a window still to come. */
  openLink: (url: string) => void;
  /** Puts up files from outside, queued for a window still to come. */
  openFiles: (paths: readonly string[]) => void;
  /** Opens a new window of its own; false where it cannot (setup is up). */
  openNewWindow: () => boolean;
  /** Brings back the windows the workspace was left with. */
  restoreWindows: (options: { personAsked: boolean }) => void;
  log: (line: string) => void;
};

export function createLaunch(
  actions: LaunchActions,
  { refused }: { refused: boolean },
) {
  let stage: LaunchStage = refused ? "refused" : "booting";
  // A person asked for the app while it booted, so its windows come up for
  // them however the launch meant to bring them back.
  let personAsked = false;

  const comeForward = () => {
    if (stage === "open") {
      actions.comeForward();
    } else {
      personAsked = true;
    }
  };

  return {
    get stage(): LaunchStage {
      return stage;
    },

    /** Whether anything may open an app window yet. */
    windowsMayOpen() {
      return stage === "open";
    },

    /**
     * Brings the window in front forward for something a person asked for,
     * or, while booting, has boot's windows come up for them.
     */
    comeForward,

    receive(request: LaunchRequest) {
      // A refused workspace's window is the only one, and takes nothing else.
      if (stage === "refused") {
        if (request.kind === "secondLaunch") {
          actions.focusRefusal();
        }
        return;
      }
      switch (request.kind) {
        case "link": {
          actions.openLink(request.url);
          return;
        }
        case "files": {
          if (request.paths.length > 0) {
            actions.openFiles(request.paths);
          }
          return;
        }
        case "activate": {
          // macOS activates an app as it launches too, so while booting this
          // says nothing about a person: boot puts the windows up as it means to.
          if (stage === "open") {
            actions.activate();
          }
          return;
        }
        case "secondLaunch": {
          // While booting, a window of its own is the one boot is about to
          // open: a person who asked for one before any was up gets that.
          if (request.newWindow) {
            if (stage === "booting") {
              actions.log("New Window during launch: boot opens the windows");
            } else if (actions.openNewWindow()) {
              return;
            }
          }
          comeForward();
          if (request.url !== undefined) {
            actions.openLink(request.url);
          }
          if (request.files.length > 0) {
            actions.openFiles(request.files);
          }
          return;
        }
      }
    },

    /**
     * Boot's one call once it can open windows: they may open from here on,
     * and the ones the workspace was left with come back.
     */
    openWindows() {
      if (stage !== "booting") {
        throw new Error(`The windows cannot open from launch stage ${stage}`);
      }
      stage = "open";
      actions.restoreWindows({ personAsked });
    },
  };
}

export type Launch = ReturnType<typeof createLaunch>;

/** This run's launch, set once by the main module before anything is handed over. */
let current: Launch | undefined;

/** Starts this run's launch. Called once, from the main module's first lines. */
export function startLaunch(
  actions: LaunchActions,
  options: { refused: boolean },
): Launch {
  if (current) {
    throw new Error("The launch has already started");
  }
  current = createLaunch(actions, options);
  return current;
}

/**
 * Whether anything may open an app window yet: only once boot has restored
 * the windows, never on a refused workspace.
 */
export function windowsMayOpen() {
  return current?.windowsMayOpen() ?? false;
}
