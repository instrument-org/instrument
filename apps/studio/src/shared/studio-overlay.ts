import { type StudioPath } from "@/shared/studio-path";
import { z } from "zod";

/**
 * The app-wide modal overlay can host different kinds of UI. Each kind is its
 * own child route under `/studio-overlay` (e.g. `/studio-overlay/login`), so routing,
 * layouts, and type-safe paths come from TanStack Router rather than a
 * hand-rolled switch. Everything else (request props, result, behavior policy)
 * stays keyed by `kind` so adding a kind is additive.
 */
export type StudioOverlayKind = "crash" | "login" | "settings" | "welcome";

/**
 * Whether the user may dismiss a kind (Escape, click-outside, Cmd+W).
 * Non-dismissible kinds gate a flow the user must finish via `resolve`.
 */
export const STUDIO_OVERLAY_DISMISSIBLE = {
  // Debug-only kind that throws on render to exercise the error fallback.
  crash: true,
  login: true,
  settings: true,
  welcome: false,
} as const satisfies Record<StudioOverlayKind, boolean>;

/**
 * Settings sections the modal can deep-link to. Mirrors the standalone
 * window's tabs; each maps to a child route under `/studio-overlay/settings`.
 */
const SETTINGS_TABS = ["Debug", "Features", "General", "Providers"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Child route path for each settings tab, type-checked against the tree. */
const SETTINGS_TAB_PATHS = {
  Debug: "/studio-overlay/settings/debug",
  Features: "/studio-overlay/settings/features",
  General: "/studio-overlay/settings",
  Providers: "/studio-overlay/settings/providers",
} as const satisfies Record<SettingsTab, StudioPath>;

const StudioOverlayLoginPropsSchema = z.object({
  hideManualProvider: z.boolean().optional(),
  reason: z.literal("provider-required").optional(),
});

const StudioOverlaySettingsPropsSchema = z.object({
  // Deep-link the modal to a section and (for Providers) auto-open the
  // add-provider dialog.
  showNewProviderDialog: z.boolean().optional(),
  tab: z.enum(SETTINGS_TABS).optional(),
});

export const StudioOverlayRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("crash"),
  }),
  z.object({
    kind: z.literal("login"),
    props: StudioOverlayLoginPropsSchema.optional(),
  }),
  z.object({
    kind: z.literal("welcome"),
  }),
  z.object({
    kind: z.literal("settings"),
    props: StudioOverlaySettingsPropsSchema.optional(),
  }),
]);

/**
 * The terminal result of a `show` call: whether the user finished the flow.
 * Dismiss, error, and replace all resolve as `{ completed: false }`; only the
 * renderer reporting success resolves `{ completed: true }`.
 */
export const StudioOverlayResultSchema = z.object({ completed: z.boolean() });

/** Booleans arrive as strings over the URL, so coerce them back. */
const UrlBoolSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional()
  .transform((value) => value === true || value === "true");

/**
 * Search params for the `/studio-overlay/login` route. Shared by the main-process
 * controller (which serializes a request into these) and the route (which
 * validates them).
 */
export const StudioOverlayLoginSearchSchema = z.object({
  hideManualProvider: UrlBoolSchema,
  reason: z.literal("provider-required").optional(),
});

/**
 * Search params for the Providers settings route, shared by the standalone
 * window route and the modal child route.
 */
export const SettingsProvidersSearchSchema = z.object({
  showNewProviderDialog: UrlBoolSchema,
});

export type StudioOverlayRequest = z.output<typeof StudioOverlayRequestSchema>;
export type StudioOverlayResult = z.output<typeof StudioOverlayResultSchema>;

/** Resolve a request to the child route path and query params to load. */
export function studioOverlayRequestToLocation(request: StudioOverlayRequest): {
  path: StudioPath;
  search: Record<string, string>;
} {
  switch (request.kind) {
    case "crash": {
      return { path: "/studio-overlay/crash", search: {} };
    }
    case "login": {
      const search: Record<string, string> = {};
      if (request.props?.hideManualProvider) {
        search.hideManualProvider = "true";
      }
      if (request.props?.reason) {
        search.reason = request.props.reason;
      }
      return { path: "/studio-overlay/login", search };
    }
    case "settings": {
      const tab = request.props?.tab ?? "General";
      const search: Record<string, string> = {};
      if (tab === "Providers" && request.props?.showNewProviderDialog) {
        search.showNewProviderDialog = "true";
      }
      return { path: SETTINGS_TAB_PATHS[tab], search };
    }
    case "welcome": {
      return { path: "/studio-overlay/welcome", search: {} };
    }
  }
}
