import { type CandidateApp } from "./types";

// How many apps the menu will show. Applied on read, after curation, so raising
// or lowering it never invalidates anything already persisted.
const MAX_CANDIDATES = 16;

// Apps that claim broad document types but never usefully open them, and that
// no structural rule in DARWIN_CANDIDATES_SCRIPT rules out. Only Apple's own
// bundled apps are listed: a third-party app is on the machine because someone
// installed it, and second-guessing that ages badly.
const EXCLUDED_BUNDLE_IDS = new Set([
  // Claims the common image types to inspect and assign color profiles, which
  // is not what "open this image" means.
  "com.apple.ColorSyncUtility",
  // Claims public.plain-text, so it shows up for Markdown and source files, but
  // opening one only offers to import it as a trace. Its name also collides
  // with ours in the menu.
  "com.apple.dt.Instruments",
  // Claims .txt and opens it as an AppleScript source buffer rather than text.
  "com.apple.ScriptEditor2",
]);

// Apps that genuinely open part of what they claim. Each maps to the extensions
// it stays listed for and is hidden everywhere else, which is finer-grained
// than dropping them outright would allow.
const RESTRICTED_BUNDLE_IDS = new Map([
  // Claims public.data as a viewer, so it offers itself for every document a
  // task produces despite being a slow launch that helps only with code.
  [
    "com.apple.dt.Xcode",
    new Set([
      ".c",
      ".cc",
      ".cpp",
      ".entitlements",
      ".h",
      ".hpp",
      ".m",
      ".metal",
      ".mm",
      ".playground",
      ".plist",
      ".storyboard",
      ".strings",
      ".swift",
      ".xib",
    ]),
  ],
  ["com.apple.iBooksX", new Set([".epub", ".ibooks", ".pdf"])],
  // Both iWork apps claim public.plain-text, putting them in front of Markdown,
  // logs and source files they would import as prose or a table.
  [
    "com.apple.iWork.Numbers",
    new Set([".csv", ".numbers", ".tsv", ".xls", ".xlsx"]),
  ],
  [
    "com.apple.iWork.Pages",
    new Set([".doc", ".docx", ".pages", ".rtf", ".txt"]),
  ],
  // Claims public.folder, which surfaces it for still images it would only
  // import as an image sequence.
  [
    "com.apple.QuickTimePlayerX",
    new Set([
      ".aac",
      ".aif",
      ".aiff",
      ".avi",
      ".m4a",
      ".m4v",
      ".mov",
      ".mp3",
      ".mp4",
      ".wav",
    ]),
  ],
]);

// Narrows a raw Launch Services enumeration to what the menu should offer.
// Applied every time candidates are read rather than before they are stored, so
// editing either list above takes effect on the next read instead of requiring
// a cache version bump.
export function curateCandidates(apps: CandidateApp[], ext: string) {
  const useful = apps.filter((candidate) => isUsefulCandidate(candidate, ext));
  if (useful.length <= MAX_CANDIDATES) {
    return useful;
  }
  const capped = useful.slice(0, MAX_CANDIDATES);
  if (capped.some((candidate) => candidate.isDefault)) {
    return capped;
  }
  const fallback = useful.find((candidate) => candidate.isDefault);
  if (!fallback) {
    return capped;
  }
  // Exempting the default from curation is pointless if the cap can still drop
  // it, and Launch Services does not promise to rank it early enough to be
  // safe. It takes the last slot rather than extending the cap; where it lands
  // is not meaningful, since a list this long has no trustworthy order anyway.
  return [...capped.slice(0, MAX_CANDIDATES - 1), fallback];
}

function isUsefulCandidate(candidate: CandidateApp, ext: string) {
  // The system's own choice is never second-guessed; it is what the primary
  // "Open in {app}" button already launches.
  if (candidate.isDefault) {
    return true;
  }
  if (EXCLUDED_BUNDLE_IDS.has(candidate.bundleId)) {
    return false;
  }
  const allowedExtensions = RESTRICTED_BUNDLE_IDS.get(candidate.bundleId);
  return allowedExtensions ? allowedExtensions.has(ext) : true;
}
