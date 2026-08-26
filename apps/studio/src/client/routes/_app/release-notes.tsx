import { ExternalLink } from "@/client/components/external-link";
import { Markdown } from "@/client/components/markdown";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME, RELEASE_NOTES_URL } from "@instrument-org/shared";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/release-notes")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Release notes" }],
  }),
  staticData: { tabIcon: "file-text" },
});

function ErrorFallback() {
  return (
    <Card>
      <CardContent className="space-y-4 py-12 text-center">
        <p className="text-muted-foreground">Failed to load release notes.</p>
        <Button
          asChild
          className="text-primary hover:text-primary/80"
          variant="link"
        >
          <ExternalLink href={RELEASE_NOTES_URL}>
            View release notes on GitHub
            <ArrowSquareOutIcon className="size-3" />
          </ExternalLink>
        </Button>
      </CardContent>
    </Card>
  );
}

function RouteComponent() {
  const releasesQuery = useQuery(rpcClient.releases.list.queryOptions());
  const appVersionQuery = useQuery(
    rpcClient.preferences.getAppVersion.queryOptions(),
  );

  const checkForUpdatesMutation = useMutation(
    rpcClient.preferences.checkForUpdates.mutationOptions(),
  );

  const handleCheckForUpdates = () => {
    checkForUpdatesMutation.mutate({});
  };

  const releases = releasesQuery.data?.releases ?? [];
  const currentVersion = appVersionQuery.data?.version;

  return (
    <div className="h-full overflow-y-auto scroll-fade-y">
      <div className="mx-auto w-full max-w-3xl flex-1">
        <div className="px-4 pt-10 @xl/app-content:px-6 @5xl/app-content:px-8 @5xl/app-content:pt-20 @5xl/app-content:pb-4">
          <div className="flex flex-col items-center gap-y-5 text-center">
            <div className="space-y-2">
              <h1 className="font-serif text-3xl leading-10 font-normal">
                Release notes
              </h1>
              <p className="text-muted-foreground">
                Updates shipped in your current version of {APP_NAME}
              </p>
            </div>
            <Button
              disabled={checkForUpdatesMutation.isPending}
              onClick={handleCheckForUpdates}
              variant="secondary"
            >
              {checkForUpdatesMutation.isPending
                ? "Checking..."
                : "Check for updates"}
            </Button>
          </div>
        </div>

        <div className="space-y-4 px-4 py-12 @xl/app-content:px-6 @5xl/app-content:px-8">
          {releasesQuery.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            ))
          ) : releasesQuery.isError ? (
            <ErrorFallback />
          ) : releases.length === 0 ? (
            <ZeroState />
          ) : (
            releases.map((release) => (
              <Card className="gap-0 overflow-hidden py-0" key={release.id}>
                <CardHeader className="px-6 pt-5 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-0.5">
                      <CardTitle className="flex items-center gap-2 text-xl leading-tight">
                        {APP_NAME} {release.name || release.tag_name}
                        {release.prerelease && (
                          <Badge variant="secondary">Beta</Badge>
                        )}
                        {currentVersion &&
                          (release.tag_name === currentVersion ||
                            release.tag_name === `v${currentVersion}`) && (
                            <Badge variant="outline">Your version</Badge>
                          )}
                      </CardTitle>
                      {release.name && release.name !== release.tag_name ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>Version {release.tag_name}</span>
                          <span>•</span>
                          <span>
                            Released on{" "}
                            {new Date(
                              release.published_at || release.created_at,
                            ).toLocaleDateString()}
                          </span>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Released on{" "}
                          {new Date(
                            release.published_at || release.created_at,
                          ).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <ExternalLink href={release.html_url}>
                        View on GitHub
                        <ArrowSquareOutIcon />
                      </ExternalLink>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="border-t border-border/50 px-6 py-6">
                  {release.body ? (
                    <div className="prose prose-sm prose-custom max-w-none dark:prose-invert prose-figcaption:text-sm prose-kbd:text-inherit prose-code:text-inherit prose-pre:text-sm prose-table:text-sm">
                      <Markdown markdown={release.body} />
                    </div>
                  ) : (
                    <p className="text-muted-foreground italic">
                      No release notes provided.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))
          )}

          {!releasesQuery.isLoading &&
            !releasesQuery.isError &&
            releases.length > 0 && (
              <div className="flex justify-center pt-4">
                <Button asChild size="lg" variant="outline">
                  <ExternalLink href={RELEASE_NOTES_URL}>
                    All release notes
                    <ArrowSquareOutIcon />
                  </ExternalLink>
                </Button>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function ZeroState() {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-muted-foreground">No releases found.</p>
      </CardContent>
    </Card>
  );
}
