import {
  rootRouteId,
  useCanGoBack,
  useMatch,
  useRouter,
} from "@tanstack/react-router";

import { ErrorCardShell } from "./error-card-shell";
import { ErrorDetails } from "./error-details";
import { InternalLink } from "./internal-link";
import { ReportErrorButton } from "./report-error-button";
import { Button } from "./ui/button";

/** `sample` marks an error drawn for a gallery, which is never sent by itself. */
export function ErrorCard({
  error,
  sample = false,
}: {
  error: unknown;
  sample?: boolean;
}) {
  const router = useRouter();
  const isRoot = useMatch({
    select: (state) => state.id === rootRouteId,
    strict: false,
  });
  const canGoBack = useCanGoBack();

  return (
    <ErrorCardShell
      actions={
        <div className="flex gap-x-2">
          {isRoot ? (
            <Button asChild variant="secondary">
              <InternalLink to="/">Home</InternalLink>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <InternalLink
                onClick={(e) => {
                  e.preventDefault();
                  if (canGoBack) {
                    router.history.back();
                  } else {
                    void router.navigate({ to: "/" });
                  }
                }}
                to="/"
              >
                Go back
              </InternalLink>
            </Button>
          )}
          <Button
            onClick={() => {
              void router.invalidate();
            }}
          >
            Try again
          </Button>
          <ReportErrorButton
            error={error}
            sample={sample}
            surface="route-error"
          />
        </div>
      }
      description="Something didn't work as expected. Try again, or go back if it keeps happening."
    >
      <ErrorDetails error={error} />
    </ErrorCardShell>
  );
}
