import { SUPPORT_URL } from "@instrument-org/shared";

import { ErrorDetails } from "./error-details";
import { ExternalLink } from "./external-link";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";

/**
 * Top-level fallback for {@link ErrorBoundary}. Rendered when the window shell
 * or providers crash outside any router, so it must not use router hooks (there
 * is no navigation to recover to). The only reliable recovery for a shell crash
 * is a full reload of the web contents.
 */
export function AppErrorFallback({ error }: { error: unknown }) {
  return (
    <div className="flex min-h-full min-w-0 flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Something went wrong</CardTitle>
          <CardDescription>
            The app hit an unexpected error. Reload to recover, or get help if
            it keeps happening.
          </CardDescription>
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
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
