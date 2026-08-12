// Rendered at 2x by the compositor, then downsampled to the menu's 64px by
// storeFileOpenIcon. Asking macOS for the icon's native size instead produces
// ~1.6MB of base64 per app.
export const ICON_RENDER_SIZE = 128;

// Enumeration is cheap, so scan well past the menu's cap and let curation run
// before anything is truncated.
export const CANDIDATE_SCAN_LIMIT = 64;

// Composites the app icon into a fixed-size canvas. NSImage exposes an icon's
// representations largest-first, so encoding one directly would ship a 1024px
// PNG; drawing into a sized canvas is what bounds the cost.
const DARWIN_RENDER_ICON_FN = `
function renderIcon(image, size) {
  const canvas = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size));
  canvas.lockFocus;
  image.drawInRectFromRectOperationFraction(
    $.NSMakeRect(0, 0, size, size),
    $.NSMakeRect(0, 0, 0, 0),
    $.NSCompositingOperationSourceOver,
    1.0,
  );
  canvas.unlockFocus;
  const rep = $.NSBitmapImageRep.imageRepWithData(canvas.TIFFRepresentation);
  const png = rep.representationUsingTypeProperties(
    $.NSBitmapImageFileTypePNG,
    $.NSDictionary.dictionary,
  );
  return png.base64EncodedStringWithOptions(0).js ?? "";
}
`;

// Resolves the default app via NSWorkspace and returns its real icon
// (works for asset-catalog-only apps where reading the .icns would fail).
export const DARWIN_RESOLVE_SCRIPT = `
ObjC.import("AppKit");
${DARWIN_RENDER_ICON_FN}
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const size = parseInt(argv[1], 10) || 128;
  const result = { appName: "", iconBase64: "" };
  try {
    const url = ws.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(argv[0]));
    const appPath = url.path.js;
    if (!appPath) {
      return JSON.stringify(result);
    }
    result.appName =
      $.NSFileManager.defaultManager.displayNameAtPath(appPath).js ?? "";
    result.iconBase64 = renderIcon(ws.iconForFile(appPath), size);
  } catch {
    // fall through with whatever resolved so far
  }
  return JSON.stringify(result);
}
`;

// Enumerates every app that can open the file (default flagged). Structurally
// unusable candidates are dropped before deduping, so an app that also has a
// copy in a cache directory is still offered from its real location. Product
// curation happens in candidate-policy, not here, so its results stay safe to
// persist. Icons are resolved separately, per app, by DARWIN_ICONS_SCRIPT.
export const DARWIN_CANDIDATES_SCRIPT = `
ObjC.import("AppKit");
// Apps bundled inside another app (Xcode's Instruments, Electron helpers) are
// reachable through Launch Services but are not things a user opens documents
// with.
function isNested(appPath) {
  return appPath.slice(0, appPath.lastIndexOf("/")).indexOf(".app/") !== -1;
}
// Copies unpacked by package managers and test harnesses claim file types just
// like a real install, and a developer machine accumulates many of them.
function isUnusableLocation(appPath) {
  const lower = appPath.toLowerCase();
  const fragments = [
    "/caches/",
    "/.cache/",
    "/node_modules/",
    "/.trash/",
    "/private/var/folders/",
  ];
  for (let i = 0; i < fragments.length; i++) {
    if (lower.indexOf(fragments[i]) !== -1) return true;
  }
  return false;
}
// Background agents declare document types but have no window to open into.
function isBackgroundAgent(bundle) {
  const info = bundle.infoDictionary;
  if (info.isNil()) return false;
  const uiElement = info.objectForKey("LSUIElement");
  if (uiElement.isNil()) return false;
  const value = String(uiElement.js);
  return value === "1" || value === "true";
}
function defaultAppPath(ws, filePath) {
  try {
    const url = ws.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(filePath));
    return url.isNil() ? "" : (url.path.js ?? "");
  } catch {
    return "";
  }
}
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const fm = $.NSFileManager.defaultManager;
  const cap = parseInt(argv[1], 10) || 64;
  const defaultPath = defaultAppPath(ws, argv[0]);
  const out = { apps: [] };
  try {
    const urls = ws.URLsForApplicationsToOpenURL($.NSURL.fileURLWithPath(argv[0]));
    const count = urls.count;
    const seen = {};
    for (let i = 0; i < count && out.apps.length < cap; i++) {
      const appPath = urls.objectAtIndex(i).path.js;
      if (!appPath) continue;
      // Whatever the system already opens this file with stays listed, so no
      // rule here can disagree with the "Open in {app}" button beside the menu.
      const isDefault = appPath === defaultPath;
      if (!isDefault && (isNested(appPath) || isUnusableLocation(appPath))) continue;
      const bundle = $.NSBundle.bundleWithPath(appPath);
      if (bundle.isNil()) continue;
      if (!isDefault && isBackgroundAgent(bundle)) continue;
      const bundleId = bundle.bundleIdentifier.js ?? "";
      const name = (fm.displayNameAtPath(appPath).js ?? "").replace(/\\.app$/, "");
      const key = bundleId || name;
      if (!name || seen[key]) continue;
      seen[key] = true;
      out.apps.push({
        appName: name,
        appPath: appPath,
        bundleId: bundleId,
        isDefault: isDefault,
      });
    }
  } catch {
    // no apps available for this type
  }
  return JSON.stringify(out);
}
`;

// Renders one icon per app path passed in argv, in a single interpreter.
export const DARWIN_ICONS_SCRIPT = `
ObjC.import("AppKit");
${DARWIN_RENDER_ICON_FN}
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const size = parseInt(argv[0], 10) || 128;
  const out = { icons: [] };
  for (let i = 1; i < argv.length; i++) {
    let iconBase64 = "";
    try {
      iconBase64 = renderIcon(ws.iconForFile(argv[i]), size);
    } catch {
      // an app without a resolvable icon still opens the file
    }
    out.icons.push({ appPath: argv[i], iconBase64: iconBase64 });
  }
  return JSON.stringify(out);
}
`;
