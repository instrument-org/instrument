import {
  APP_BUNDLE_ID,
  APP_DOMAIN,
  APP_EXECUTABLE,
  APP_NAME,
  APP_PROTOCOL,
  APP_UPDATER_CACHE_DIR_NAME,
} from "@instrument-org/shared";
import dotenv from "dotenv";
import {
  type Configuration,
  type PlatformSpecificBuildOptions,
} from "electron-builder";

import { runAfterPack } from "./electron-builder/after-pack";

if (process.env.CI !== "true") {
  dotenv.config({
    path: [".env.build"],
  });
}

const publishConfig: PlatformSpecificBuildOptions["publish"] = {
  bucket: "instrument-releases",
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  endpoint: process.env.BUILDER_PUBLISH_S3_ENDPOINT,
  provider: "s3",
  region: "auto",
  updaterCacheDirName: APP_UPDATER_CACHE_DIR_NAME,
};

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
  asarUnpack: [
    "resources/**",
    "**/node_modules/dugite/git/**",
    "**/node_modules/pnpm/**",
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
  // cspell:ignore orgstudio
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
    {
      from: "../../packages/shim-client/dist",
      to: "shim-client",
    },
  ],
  files: [
    "out/**/*",
    "resources/**/*",
    "node_modules/**",
    "!**/node_modules/**/*.md",
    "!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}",
    // Type declarations are never loaded at runtime. The single-star form
    // electron-builder documents only matches a `.d.ts` sitting directly in a
    // `node_modules` directory rather than inside a package, which is nothing.
    "!**/node_modules/**/*.d.{ts,mts,cts}",
    // Packages occasionally publish their own Yarn install state. Nothing
    // reads it, and `.yarn-integrity` below is the only part of it that
    // electron-builder excludes on its own.
    "!**/node_modules/**/.yarn/**",
    "!**/node_modules/.bin",
    // sql.js backs just-bash's `sqlite3`. Only the wasm build's loader and its
    // .wasm are reachable from Node; the asm.js, browser, and debug variants are
    // ~17MB of the package's 18MB and nothing loads them.
    "!**/node_modules/sql.js/dist/{sql-asm*,worker.sql-*,*-debug.*,sql-wasm-browser.*}",
    "!**/*.map", // someday we may want to keep these for debugging
    /* cspell:disable */
    "!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}",
    "!.editorconfig",
    "!**/._*",
    "!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}",
    "!**/{__pycache__,thumbs.db,.flowconfig,.idea,.vs,.nyc_output}",
    "!**/{appveyor.yml,.travis.yml,circle.yml}",
    "!**/{npm-debug.log,yarn.lock,.yarn-integrity,.yarn-metadata.json}",
    "!**/*.local/**",
    /* cspell:enable */
  ],
  generateUpdatesFilesForAllChannels: true,
  linux: {
    artifactName: "${productName}-${os}-${version}-${arch}.${ext}",
    category: "Utility",
    executableArgs: ["--ozone-platform=x11"],
    executableName: APP_EXECUTABLE,
    icon: "build/icons",
    maintainer: APP_DOMAIN,
    target: ["AppImage", "deb", "rpm", "tar.gz"],
  },
  mac: {
    category: "public.app-category.developer-tools",
    entitlementsInherit: "build/entitlements.mac.plist",
    extendInfo: {
      // Must match the Icon Composer bundle name (build/icon.icon).
      CFBundleIconName: "icon",
      // Restrict macOS verification-code AutoFill to explicitly annotated OTP fields.
      NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
      NSLocalNetworkUsageDescription: `${APP_NAME} uses your local network to connect to tools needed for your tasks.`,
    },
    gatekeeperAssess: false,
    hardenedRuntime: true,
    // macOS 26+ uses build/icon.icon (compiled to Assets.car); older macOS uses build/icon.icns.
    icon: "icon.icon",
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    notarize: process.env.APPLE_NOTARIZATION_ENABLED === "true",
    publish: {
      ...publishConfig,
      channel:
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        process.env.ARCH === "x64" ? "${channel}-${arch}" : undefined,
    },
    target: ["dmg", "zip"],
  },
  npmRebuild: true,
  nsis: {
    artifactName: "${productName}-${os}-${version}-${arch}.${ext}",
    createDesktopShortcut: "always",
    shortcutName: "${productName}",
    uninstallDisplayName: "${productName}",
  },
  productName: APP_NAME,
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
      publisherName: "Finalpoint, LLC",
      sign: "electron-builder/win-cloud-hsm-sign.js",
    },
    target: ["nsis"],
  },
};

export default config;
