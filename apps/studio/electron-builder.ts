import {
  APP_BUNDLE_ID,
  APP_DOMAIN,
  APP_EXECUTABLE,
  APP_NAME,
  APP_PREVIEW_NAME,
  APP_PRODUCT_NAME,
  APP_PROTOCOL,
  APP_UPDATER_CACHE_DIR_NAME,
} from "@instrument-org/shared";
import dotenv from "dotenv";
import {
  type Configuration,
  type PlatformSpecificBuildOptions,
} from "electron-builder";

import { runAfterPack } from "./electron-builder/after-pack";
import {
  macFileAssociations,
  writeWindowsInstallerScript,
} from "./electron-builder/file-associations";

if (process.env.CI !== "true") {
  dotenv.config({
    path: [".env.build"],
  });
}

const publishConfig: PlatformSpecificBuildOptions["publish"] = {
  bucket: "instrument-releases",
  endpoint: process.env.BUILDER_PUBLISH_S3_ENDPOINT,
  provider: "s3",
  region: "auto",
  updaterCacheDirName: APP_UPDATER_CACHE_DIR_NAME,
};

// Merged into Info.plist ahead of `fileAssociations`, which can name
// extensions only. Text and code have too many extensions to list, and one
// content type covers them, since a source file's type conforms to plain text.
// Not `.ts`, which macOS types as an MPEG transport stream. Folders are what
// the Dock icon accepts a dropped folder by; public.folder rather than
// public.directory, which app bundles and other packages conform to.
const macDocumentTypes = [
  {
    CFBundleTypeName: "Text",
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Alternate",
    LSItemContentTypes: ["public.plain-text", "public.json"],
  },
  {
    CFBundleTypeName: "Folder",
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Alternate",
    LSItemContentTypes: ["public.folder"],
  },
];

/**
 * @see https://www.electron.build/#documentation
 */
const config: Configuration = {
  afterPack: runAfterPack,
  appId: APP_BUNDLE_ID,
  appImage: {
    artifactName: "${productName}-${os}-${version}-${arch}.${ext}",
  },
  // dugite's git distribution has to sit on the real filesystem to be
  // executable; dugite resolves it by rewriting `app.asar` to
  // `app.asar.unpacked` and gets ENOENT if it was never unpacked.
  //
  // pnpm is forked as a subprocess (`pnpm/bin/pnpm.mjs`) to install task
  // dependencies, so it too must live on the real filesystem. pnpm 11 bundles
  // its own dependencies and ships no top-level native module, so
  // electron-builder's automatic native-module unpacking no longer covers it
  // (pnpm 10 was unpacked as a side effect of its top-level reflink `.node`).
  // Unpack it explicitly; afterPack verifies the entry survived.
  //
  // The Cua Driver SDK loads its Rust library with dlopen from a path next to
  // its `.node`, and dlopen cannot read inside an asar.
  asarUnpack: [
    "resources/**",
    "**/node_modules/dugite/git/**",
    "**/node_modules/pnpm/**",
    "**/node_modules/@trycua/cua-driver-*/**",
  ],
  directories: {
    buildResources: "build",
    output: process.env.ELECTRON_BUILDER_OUTPUT_DIR ?? "dist",
  },
  dmg: {
    artifactName: "${productName}-${os}-${version}-${arch}.${ext}",
    // DMG volume icons still use .icns even when the app bundle uses .icon (macOS 26+).
    icon: "icon.icns",
  },
  // Refuses `--inspect` and SIGUSR1 on the packaged binary, so no other
  // process can start Instrument with a debugger on main and read what
  // safeStorage decrypts. RunAsNode and NODE_OPTIONS stay on: the agent's
  // `node` is this binary in Node mode, and projects lean on NODE_OPTIONS.
  // Flipping a fuse rewrites a page of Electron Framework, which breaks its
  // linker-signed ad-hoc signature. A signed build re-signs it anyway; an
  // unsigned one (`identity: null`, the smoke test) is SIGKILLed on its first
  // fuse read on Apple Silicon unless the ad-hoc signature is reset.
  electronFuses: {
    enableNodeCliInspectArguments: false,
    resetAdHocDarwinSignature: true,
  },
  // NSIS derives the Windows install folder (%LOCALAPPDATA%\Programs\<name>)
  // from package.json `name`, which sanitizes "@instrument-org/studio" into the
  // ugly "@instrument-orgstudio". Override the metadata name so the install
  // folder matches the product name ("Instrument") instead.
  // Chromium carries a locale bundle per language it has ever been translated
  // into, which is ~48MB of the macOS app across 220 `.lproj` directories.
  // Studio's own UI is English-only, so only English survives.
  //
  // The name is region-qualified because the match runs both ways: "en-US"
  // keeps macOS's bare `en.lproj` as well as the `en-US.pak` Windows and Linux
  // ship. electron-builder skips the cleanup entirely rather than leave a
  // locales directory empty, so a name that matches nothing cannot produce an
  // app that fails to boot.
  electronLanguages: ["en-US"],
  extraMetadata: {
    name: APP_NAME,
    // Electron names the userData folder and the keychain's Safe Storage item
    // after this, which is what keeps a preview's state apart from the app's.
    productName: APP_PRODUCT_NAME,
  },
  extraResources: [
    {
      filter: ["**/*"],
      from: "../../packages/workspace/templates/default",
      to: "default-task-template",
    },
    {
      filter: ["**/*.json"],
      from: "../../registry/api",
      to: "registry/api",
    },
    {
      filter: ["**/*"],
      from: "../../registry/skills",
      to: "registry/skills",
    },
    {
      filter: ["**/*"],
      from: "../../packages/workspace/system-skills",
      to: "system-skills",
    },
    // The directory's icons; the manifest beside them is for the refresh
    // script and stays behind.
    {
      filter: ["*.png", "*.svg"],
      from: "../../packages/workspace/directory-icons",
      to: "directory-icons",
    },
  ],
  files: [
    "out/**/*",
    "resources/**/*",
    "node_modules/**",
    "!**/node_modules/**/*.md",
    "!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}",
    "!**/node_modules/.bin",
    // sql.js backs just-bash's `sqlite3`. Only the wasm build's loader and its
    // .wasm are reachable from Node; the asm.js, browser, and debug variants are
    // ~17MB of the package's 18MB and nothing loads them.
    "!**/node_modules/sql.js/dist/{sql-asm*,worker.sql-*,*-debug.*,sql-wasm-browser.*}",
    // date-fns resolves its default locale by requiring `locale/en-US`, so
    // that one locale and the builders it shares under `locale/_lib` load
    // whether or not anything asks for a locale by name. Nothing here asks:
    // every call site imports arithmetic or ISO parsing. The other ~110
    // locales and the `cdn` browser bundles beside them are ~6.5MB.
    //
    // Order matters. Each re-include has to follow the exclusion, and the
    // directory itself is re-included by the partial match electron-builder
    // does on directories, which is what lets the walker descend at all.
    "!**/node_modules/date-fns/locale/**",
    "**/node_modules/date-fns/locale/_lib/**",
    "**/node_modules/date-fns/locale/en-US/**",
    "**/node_modules/date-fns/locale/en-US.*",
    // quickjs-emscripten backs just-bash's `js-exec`, which the workspace
    // enables. Its index requires all four wasm variants by name, so each
    // variant's small `index`/`ffi` entry has to ship, but a variant only
    // loads its `emscripten-module` glue and wasm when asked for, and
    // `getQuickJS()` asks for release-sync alone. The other three variants'
    // modules (~5MB), the release variant's browser and Cloudflare glue, and
    // the package's 2.3MB browser bundle are weight nothing loads.
    "!**/node_modules/quickjs-emscripten/dist/index.global.js",
    "!**/node_modules/@jitl/quickjs-wasmfile-{debug-sync,debug-asyncify,release-asyncify}/dist/emscripten-module.*",
    "!**/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.{browser,cloudflare}.*",
    // These two are last among the node_modules rules because a later pattern
    // wins: they have to apply to whatever the package-specific rules above
    // re-included, not be undone by them.
    //
    // Type declarations are never loaded at runtime. The single-star form
    // electron-builder documents only matches a `.d.ts` sitting directly in a
    // `node_modules` directory rather than inside a package, which is nothing.
    "!**/node_modules/**/*.d.{ts,mts,cts}",
    // Packages occasionally publish their own Yarn install state. Nothing
    // reads it, and `.yarn-integrity` below is the only part of it that
    // electron-builder excludes on its own.
    "!**/node_modules/**/.yarn/**",
    "!**/*.map", // someday we may want to keep these for debugging
    "!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}",
    "!.editorconfig",
    "!**/._*",
    "!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}",
    "!**/{__pycache__,thumbs.db,.flowconfig,.idea,.vs,.nyc_output}",
    "!**/{appveyor.yml,.travis.yml,circle.yml}",
    "!**/{npm-debug.log,yarn.lock,.yarn-integrity,.yarn-metadata.json}",
    "!**/*.local/**",
  ],
  generateUpdatesFilesForAllChannels: true,
  linux: {
    artifactName: "${productName}-${os}-${version}-${arch}.${ext}",
    category: "Utility",
    executableName: APP_EXECUTABLE,
    icon: "build/icons",
    maintainer: APP_DOMAIN,
    target: ["AppImage", "deb", "rpm", "tar.gz"],
  },
  mac: {
    category: "public.app-category.developer-tools",
    // Split deliberately. The app's own entitlements carry what the
    // provisioning profile grants; the helpers get the hardened-runtime keys
    // and nothing else. Naming only entitlementsInherit once left both
    // pointing here by default, which put an app-scoped entitlement on all
    // four helpers and produced a build that signed, notarized, and could not
    // launch -- docs/findings/an-entitlement-that-notarizes-and-will-not-launch.md.
    entitlements: APP_PREVIEW_NAME
      ? "build/entitlements.mac.preview.plist"
      : "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.inherit.plist",
    // Both halves of the Mac bridge (lib/mac-native.ts): the helper behind
    // the agent's `calendar` and `contacts` commands and the module main
    // loads, built by `pnpm build:mac-helper` before packaging.
    extraResources: [
      {
        from: "native/mac-helper/.build/bridge/instrument-mac",
        to: "bin/instrument-mac",
      },
      {
        from: "native/mac-helper/.build/bridge/instrument-mac.node",
        to: "bin/instrument-mac.node",
      },
    ],
    extendInfo: {
      // A preview claims no document types: installing one must not change
      // what opens a file on the machine it is tried on.
      ...(APP_PREVIEW_NAME ? {} : { CFBundleDocumentTypes: macDocumentTypes }),
      // Must match the Icon Composer bundle name (build/icon.icon).
      CFBundleIconName: "icon",
      // Why the system's own ask names a reason: without these macOS asks for
      // each protected folder with generic text. Each is raised the first time
      // a task is handed the folder.
      NSAppDataUsageDescription: `${APP_NAME} reads another app's files when you ask it to work with them.`,
      // Asked the first time a task reads or adds to each, through the
      // bundled Mac helper behind the agent's `calendar` and `contacts`
      // commands.
      NSContactsUsageDescription: `${APP_NAME} looks people up in your contacts when you ask it to, like an email address or a birthday.`,
      NSCalendarsFullAccessUsageDescription: `${APP_NAME} reads and adds to your calendars when you ask it to, like checking tomorrow or adding a meeting.`,
      NSCalendarsUsageDescription: `${APP_NAME} reads and adds to your calendars when you ask it to, like checking tomorrow or adding a meeting.`,
      NSRemindersFullAccessUsageDescription: `${APP_NAME} reads and adds to your reminders when you ask it to, like what is due today or a new reminder.`,
      NSRemindersUsageDescription: `${APP_NAME} reads and adds to your reminders when you ask it to, like what is due today or a new reminder.`,
      // Asked the first time a task controls each app, named in the ask.
      NSAppleEventsUsageDescription: `${APP_NAME} works in this app when you ask it to, like adding a reminder or a calendar event.`,
      // Restrict macOS verification-code AutoFill to explicitly annotated OTP fields.
      NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
      NSDesktopFolderUsageDescription: `${APP_NAME} reads and writes files on your Desktop when you ask it to work there.`,
      NSDocumentsFolderUsageDescription: `${APP_NAME} reads and writes files in your Documents when you ask it to work there, and keeps what it makes in Documents/${APP_NAME}.`,
      NSDownloadsFolderUsageDescription: `${APP_NAME} reads and writes files in your Downloads when you ask it to work there.`,
      NSLocalNetworkUsageDescription: `${APP_NAME} uses your local network to connect to tools needed for your tasks.`,
      NSNetworkVolumesUsageDescription: `${APP_NAME} reads and writes files on a network drive when you ask it to work there.`,
      NSRemovableVolumesUsageDescription: `${APP_NAME} reads and writes files on a removable drive when you ask it to work there.`,
    },
    fileAssociations: APP_PREVIEW_NAME ? [] : macFileAssociations,
    gatekeeperAssess: false,
    hardenedRuntime: true,
    // macOS 26+ uses build/icon.icon (compiled to Assets.car); older macOS uses build/icon.icns.
    icon: "icon.icon",
    notarize: process.env.APPLE_NOTARIZATION_ENABLED === "true",
    // Grants the team-scoped entitlements in entitlements.mac.plist. Without
    // it the system refuses them and the app is killed on exec.
    // A preview goes without: the profile is bound to the shipping bundle id.
    provisioningProfile: APP_PREVIEW_NAME
      ? undefined
      : "build/Instrument_Developer_ID.provisionprofile",
    publish: {
      ...publishConfig,
      channel: process.env.ARCH === "x64" ? "${channel}-${arch}" : undefined,
    },
    target: ["dmg", "zip"],
  },
  npmRebuild: true,
  nsis: {
    artifactName: "${productName}-${os}-${version}-${arch}.${ext}",
    createDesktopShortcut: "always",
    // The installer drawn at the display's scale, and Open With for the
    // types Instrument shows. Not `win.fileAssociations`, whose macro makes
    // the app each extension's default.
    include: writeWindowsInstallerScript(),
    shortcutName: "${productName}",
    uninstallDisplayName: "${productName}",
  },
  productName: APP_PRODUCT_NAME,
  protocols: [
    {
      // Required for Linux deep linking
      name: APP_NAME,
      schemes: [APP_PROTOCOL],
    },
  ],
  publish: publishConfig,
  win: {
    signtoolOptions: {
      // Both casings the certificate subject has been issued under. An update is
      // rejected unless the installed build's list contains the incoming
      // installer's CN verbatim, and the comparison is case sensitive.
      publisherName: ["Finalpoint, LLC", "FINALPOINT, LLC"],
      sign: "electron-builder/win-cloud-hsm-sign.js",
    },
    target: ["nsis"],
  },
};

export default config;
