/// <reference types="vite/client" />

// oxlint-disable-next-line typescript/no-empty-object-type
interface ImportMetaEnv extends ImportMetaEnvAugmented {
  // Now import.meta.env is totally type-safe and based on your `env.ts` schema definition
  // You can also add custom variables that are not defined in your schema
}

type ImportMetaEnvAugmented =
  // oxlint-disable-next-line typescript/consistent-type-imports
  import("@julr/vite-plugin-validate-env").ImportMetaEnvAugmented<
    // oxlint-disable-next-line typescript/consistent-type-imports
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
      APPLE_NOTARIZATION_ENABLED: string | undefined;
      ARCH: string | undefined;
      BUILDER_PUBLISH_S3_ENDPOINT: string | undefined;
      CC: string | undefined;
      CI: string | undefined;
      DEVELOPER_DIR: string | undefined;
      DISABLE_AUTO_UPDATE_POLLING: string | undefined;
      /** Dev only: keep main and preload at the bytes they booted with. */
      DISABLE_DEV_RELAUNCH: string | undefined;
      ELECTRON_BUILDER_OUTPUT_DIR: string | undefined;
      ELECTRON_DEV_USER_FOLDER_SUFFIX: string | undefined;
      ELECTRON_ENABLE_CONSOLE_LOGGING: string | undefined;
      ELECTRON_RENDERER_URL: string | undefined;
      ELECTRON_USE_NEW_USER_FOLDER: string | undefined;
      ELECTRON_USER_DATA_DIR: string | undefined;
      FORCE_DEV_AUTO_UPDATE: string | undefined;
      GDK_BACKEND: string | undefined;
      HOME: string | undefined; // Only used in workspace
      /**
       * Linux only: which display protocol Electron talks. `x11`, `wayland`, or
       * `auto`; anything else is ignored. See
       * docs/findings/drag-out-does-not-cross-xwayland.md.
       */
      INSTRUMENT_OZONE_PLATFORM: string | undefined;
      NODE_ENV: string | undefined;
      PATH: string | undefined;
      /** Dev only: the port electron-vite gives the Electron child for CDP. */
      REMOTE_DEBUGGING_PORT: string | undefined;
      SIGNTOOL_PATH: string | undefined;
      SKIP_MOVE_TO_APPLICATIONS: string | undefined;
      SKIP_ONBOARDING: string | undefined;
      /** Dev only: why studio-drive launched this instance. */
      STUDIO_DRIVE_PURPOSE: string | undefined;
      TARGET_PLATFORM: string | undefined;
      /** Set by a Wayland compositor. The signal Chromium reads for `auto`. */
      WAYLAND_DISPLAY: string | undefined;
      WIN_CERT_PATH: string | undefined;
      WIN_GCP_KMS_KEY_VERSION: string | undefined;
      WIN_TIMESTAMP_URL: string | undefined;
      XDG_CURRENT_DESKTOP: string | undefined;
      XDG_DATA_DIRS: string | undefined;
    };
  }
}
