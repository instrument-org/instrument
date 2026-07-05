import { SUPPORT_URL } from "@instrument-org/shared";
import {
  rootRouteId,
  useCanGoBack,
  useMatch,
  useRouter,
} from "@tanstack/react-router";

import { ErrorDetails } from "./error-details";
import { ExternalLink } from "./external-link";
import { InternalLink } from "./internal-link";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";

export function ErrorCard({
  description = "Something didn't work as expected. Try again, or go back if it keeps happening.",
  error,
  title = "Something went wrong",
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
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ErrorDetails error={error} />
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Still having trouble?{" "}
          <ExternalLink
            className="underline underline-offset-2 hover:text-foreground"
            href={SUPPORT_URL}
          >
            Get help
          </ExternalLink>
        </p>
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
      </CardFooter>
    </Card>
  );
}
