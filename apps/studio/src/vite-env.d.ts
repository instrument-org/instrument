/// <reference types="vite/client" />

// oxlint-disable-next-line typescript/no-empty-object-type
interface ImportMetaEnv extends ImportMetaEnvAugmented {
  // Now import.meta.env is totally type-safe and based on your `env.ts` schema definition
  // You can also add custom variables that are not defined in your schema
}

type ImportMetaEnvAugmented =
  import("@julr/vite-plugin-validate-env").ImportMetaEnvAugmented<
    typeof import("../validate-env").default
  >;

interface ViteTypeOptions {
  // Avoid adding an index type to `ImportMetaDev` so
  // there's an error when accessing unknown properties.
  // ⚠️ This option requires Vite 6.3.x or higher
  strictImportMetaEnv: unknown;
}

declare namespace NodeJS {
  interface Process {
    /** Ensures we don't accidentally use process.env for other variables */
    env: {
      ANALYZE_BUILD: string | undefined;
      /** Linux only: the image an AppImage build runs from, set by its runtime. */
      APPIMAGE: string | undefined;
      APPLE_NOTARIZATION_ENABLED: string | undefined;
      ARCH: string | undefined;
      /** scripts/billing-e2e.ts: the local API it drives Studio against. */
      BILLING_BASE_URL: string | undefined;
      BUILDER_PUBLISH_S3_ENDPOINT: string | undefined;
      CI: string | undefined;
      DEVELOPER_DIR: string | undefined;
      DISABLE_AUTO_UPDATE_POLLING: string | undefined;
      /** Dev only: keep main and preload at the bytes they booted with. */
      DISABLE_DEV_RELAUNCH: string | undefined;
      ELECTRON_BUILDER_OUTPUT_DIR: string | undefined;
      ELECTRON_DEV_USER_FOLDER_SUFFIX: string | undefined;
      ELECTRON_ENABLE_CONSOLE_LOGGING: string | undefined;
      ELECTRON_RENDERER_URL: string | undefined;
      ELECTRON_USER_DATA_DIR: string | undefined;
      FAKE_MICROPHONE: string | undefined;
      FORCE_DEV_AUTO_UPDATE: string | undefined;
      GDK_BACKEND: string | undefined;
      HOME: string | undefined; // Only used in workspace
      /** Dev and preview builds only: each minute of the automatic restart's waits becomes a second. */
      IDLE_RESTART_FAST: string | undefined;
      /** Dev only: stage a made-up update and install it by restarting the same build. */
      IDLE_RESTART_SIMULATE: string | undefined;
      /** Test seam, preview builds only: the update feed a preview checks, which turns its updater on. */
      INSTRUMENT_TEST_UPDATE_FEED: string | undefined;
      /** scripts/billing-e2e.ts: the internal repo's apps/api checkout. */
      INSTRUMENT_API_DIR: string | undefined;
      /** `0` keeps the agent's bash interpreter on the main thread instead of its worker. */
      INSTRUMENT_BASH_WORKER: string | undefined;
      /** Dev only: shrinks every model's context window to this many tokens. */
      INSTRUMENT_CONTEXT_LENGTH_OVERRIDE: string | undefined;
      /** `0` opens no channel for a script's `instrument`, as the evals' bash-only arm does. */
      INSTRUMENT_SCRIPT_CHANNEL: string | undefined;
      /** Dev only: set by scripts/dev-supervisor.mjs, which restarts electron-vite on request. */
      INSTRUMENT_DEV_SUPERVISOR: string | undefined;
      /**
       * Development builds only: pins the network status the window's corner
       * shows, `offline` or `instrument-unreachable`. See
       * electron-main/lib/network-status.ts.
       */
      INSTRUMENT_NETWORK_STATUS: string | undefined;
      /** `0` keeps every pipeline stage on the buffered path, for comparing it with streaming between native commands. */
      INSTRUMENT_NATIVE_PIPES: string | undefined;
      /**
       * The folder standing for the home folder where every workspace's work
       * folders go: studio-drive sets it for a seeded or clean-room instance.
       * See packages/workspace/src/lib/work-folders.ts.
       */
      INSTRUMENT_DATA_HOME: string | undefined;
      /**
       * Linux only: which display protocol Electron talks. `x11`, `wayland`, or
       * `auto`; anything else is ignored. See
       * docs/findings/drag-out-does-not-cross-xwayland.md.
       */
      INSTRUMENT_OZONE_PLATFORM: string | undefined;
      /**
       * Where finished work goes for a workspace in the app's own data, in
       * place of the flavor's folder in the home folder: studio-drive sets it
       * for a fixture. See create-workspace-actor.ts.
       */
      INSTRUMENT_OUTPUT_FOLDER: string | undefined;
      /**
       * Dev only: what setup's launch account checks answer (`ready`,
       * `no-plan`, `out-of-usage`, `signed-out`) in place of a real check.
       * See electron-main/lib/setup-facts.ts.
       */
      INSTRUMENT_ACCOUNT_CHECK: string | undefined;
      /** Dev only: the notification status the Mac bridge answers in place of macOS's (`notificationStatus`). */
      INSTRUMENT_NOTIFICATION_STATUS: string | undefined;
      /**
       * Dev only, beside `INSTRUMENT_NOTIFICATION_STATUS`: how the prompt
       * answers (`allowed`, `denied`), or `clicked` for allowed with the test
       * notification clicked at once (`requestNotifications`, `showTestNotification`).
       */
      INSTRUMENT_NOTIFICATION_ANSWER: string | undefined;
      /** Dev only: a stand-in home folder for the folders setup offers (`workspaces.folder`). */
      INSTRUMENT_SETUP_HOME: string | undefined;
      /**
       * Development builds only: the platform API this launch talks to, over
       * the build's and the one chosen in Settings. See setup-environment.ts.
       */
      INSTRUMENT_PLATFORM_API: string | undefined;
      /** Build time only: names a preview build, inlined by electron.vite.config.ts. */
      INSTRUMENT_PREVIEW_NAME: string | undefined;
      /**
       * Pins this process to one workspace, by registered id or absolute path,
       * without changing which one the app opens next. See lib/workspaces.ts.
       */
      INSTRUMENT_WORKSPACE: string | undefined;
      NODE_ENV: string | undefined;
      /** Windows only: where OneDrive keeps its folder, set by OneDrive. */
      OneDrive: string | undefined;
      /** Windows only: the work or school account's OneDrive folder. */
      OneDriveCommercial: string | undefined;
      /** Windows only: the personal account's OneDrive folder. */
      OneDriveConsumer: string | undefined;
      PATH: string | undefined;
      /** A workspace to rehearse the launch migrations on a clone of (migration-rehearsal.test.ts). */
      REHEARSE_WORKSPACE: string | undefined;
      /** Dev only: the port electron-vite gives the Electron child for CDP. */
      REMOTE_DEBUGGING_PORT: string | undefined;
      /** The person's login shell, read for its PATH when the passwd entry names none. */
      SHELL: string | undefined;
      SIGNTOOL_PATH: string | undefined;
      SKIP_MOVE_TO_APPLICATIONS: string | undefined;
      SKIP_ONBOARDING: string | undefined;
      /** Smoke test only: a packaged app's output folder to test instead of building one. */
      SMOKE_TEST_DIST_DIR: string | undefined;
      /** Dev only: the DEV_INSTANCE_COLORS name studio-drive marked this instance with. */
      STUDIO_DRIVE_COLOR: string | undefined;
      /** Dev only: why studio-drive launched this instance. */
      STUDIO_DRIVE_PURPOSE: string | undefined;
      /** Dev only: `1` when studio-drive booted this instance with its windows on screen (`--visible`). */
      STUDIO_DRIVE_VISIBLE: string | undefined;
      /** Dev only: the lowest electron-log level the terminal shows; `warn` when unset. */
      STUDIO_LOG_LEVEL: string | undefined;
      /** Dev only: `1` when studio-drive booted this instance with its own macOS privacy grants (`--own-privacy`). */
      STUDIO_OWN_PRIVACY: string | undefined;
      /** Set by Windows: the drive it runs from, such as `C:`. */
      SystemDrive: string | undefined;
      /** Set by Windows: its own folder, such as `C:\Windows`. */
      SystemRoot: string | undefined;
      TARGET_PLATFORM: string | undefined;
      /** Set by a Wayland compositor. The signal Chromium reads for `auto`. */
      /** How many threads Node's file I/O pool has; read once, when the pool starts (`thread-pool.ts`). */
      UV_THREADPOOL_SIZE: string | undefined;
      WAYLAND_DISPLAY: string | undefined;
      WIN_CERT_PATH: string | undefined;
      WIN_GCP_KMS_KEY_VERSION: string | undefined;
      WIN_TIMESTAMP_URL: string | undefined;
      XDG_CURRENT_DESKTOP: string | undefined;
      XDG_DATA_DIRS: string | undefined;
      /** Where Linux keeps a person's data, the Trash among it; `~/.local/share` when unset. */
      XDG_DATA_HOME: string | undefined;
      /**
       * Set by the session manager. The second Wayland signal, for a launch
       * context that carries it while dropping `WAYLAND_DISPLAY`.
       */
      XDG_SESSION_TYPE: string | undefined;
    };
  }
}
