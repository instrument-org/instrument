import type { ErrorInfo } from "react";

// Report a render/lifecycle error caught by an error boundary (a router route
// boundary or the top-level shell boundary), tagged with the component stack.
// Shared so shell crashes are reported identically to router-caught ones.
export function captureComponentError(error: unknown, errorInfo: ErrorInfo) {
  captureException(error, { componentStack: errorInfo.componentStack });
}

// Loudly report a caught exception to the console. Use for failures that
// should never happen (e.g. foundational boot data not resolving), not for
// expected/handled errors. Nothing here leaves the device.
export function captureException(
  error: unknown,
  properties?: Record<string, unknown>,
) {
  if (properties === undefined) {
    console.error(error);
    return;
  }
  console.error(error, properties);
}
