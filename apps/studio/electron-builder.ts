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
  asarUnpack: ["resources/**", "**/node_modules/dugite/git/**"],
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
    "!**/node_modules/*.d.ts",
    "!**/node_modules/.bin",
    "!**/node_modules/sql.js/**", // just-bash peer dep for sqlite3 command; non-functional in asar (worker.js missing), stubbed out -- saves ~18MB
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
