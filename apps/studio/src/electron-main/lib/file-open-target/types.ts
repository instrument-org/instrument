import { z } from "zod";

// An app that can open a file, before its icon has been resolved. Icons are
// keyed by app path rather than by file type, so they are cached and rendered
// once per app instead of once per app per extension.
export interface CandidateApp {
  appName: string;
  appPath: string;
  bundleId: string;
  isDefault: boolean;
}

export interface FileOpenCandidate {
  appName: string;
  appPath: string;
  iconUrl: null | string;
  isDefault: boolean;
}

export interface FileOpenTarget {
  appName: null | string;
  iconUrl: null | string;
  // The app to launch in place of the system's choice, set only when that
  // choice is Instrument itself. Null means the system default is launched.
  launchAppPath: null | string;
}

// What a platform resolver reports about the app the system would use. Distinct
// from FileOpenTarget, whose null appName means "nothing resolved".
export interface ResolvedApp {
  appName: string;
  // Only macOS reports one; it is how the system choosing Instrument is caught.
  bundleId: null | string;
  iconUrl: null | string;
}

// Shared because the same shape is both parsed out of the macOS enumeration and
// persisted verbatim.
export const CandidateAppSchema = z.object({
  appName: z.string(),
  appPath: z.string(),
  bundleId: z.string(),
  isDefault: z.boolean(),
});
