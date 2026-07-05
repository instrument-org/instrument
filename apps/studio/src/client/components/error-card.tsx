import {
  rootRouteId,
  useCanGoBack,
  useMatch,
  useRouter,
} from "@tanstack/react-router";

import { ErrorCardShell } from "./error-card-shell";
import { InternalLink } from "./internal-link";
import { Button } from "./ui/button";

export function ErrorCard({
  description = "Something didn't work as expected. Try again, or go back if it keeps happening.",
  error,
  title,
}: {
  description?: string;
  error: unknown;
  title?: string;
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
        </div>
      }
      description={description}
      error={error}
      title={title}
    />
  );
}
