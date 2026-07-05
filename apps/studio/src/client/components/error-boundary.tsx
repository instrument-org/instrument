import { captureException } from "@/client/lib/telemetry";
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  // Rendered as an element (not called as a function) so React sets up its
  // hook dispatcher / React Compiler cache for it -- calling it directly trips
  // "Invalid hook call".
  FallbackComponent: ComponentType<{ error: unknown; reset: () => void }>;
}

interface ErrorBoundaryState {
  error: unknown;
}

/**
 * A real React error boundary for render/lifecycle errors that escape
 * TanStack Router's per-route `errorComponent` -- e.g. a crash in the window
 * chrome, providers, or shell that renders *outside* any `RouterProvider`.
 * Without this such an error white-screens the whole web contents.
 *
 * React 19 still ships no built-in boundary, so this stays a class component.
 * Every caught error is reported via {@link captureException} (console + PostHog)
 * so shell crashes are as visible as router-caught ones.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    captureException(error, { componentStack: errorInfo.componentStack });
  }

  render() {
    if (this.state.error != null) {
      const { FallbackComponent } = this.props;
      return <FallbackComponent error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }

  reset = () => {
    this.setState({ error: null });
  };
}
