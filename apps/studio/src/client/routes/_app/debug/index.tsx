import { InternalLink } from "@/client/components/internal-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/client/components/ui/table";
import { rpcClient } from "@/client/rpc/client";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { debugRoutes, getDebugRoute } from "./-debug-routes";

export const Route = createFileRoute("/_app/debug/")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: getDebugRoute("index").title,
      },
    ],
  }),
});

function RouteComponent() {
  const { data } = useQuery(rpcClient.debug.systemInfo.queryOptions());

  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Debug Home
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Jump to a debug route.
          </h1>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {debugRoutes.map((route) => {
            if (!route.showCard) {
              return null;
            }

            return (
              <InternalLink
                className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                key={route.to}
                to={route.to}
              >
                <Card className="h-full gap-4 border-border/70 bg-card/80 transition-colors hover:border-foreground/20 hover:bg-accent/40">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <CardTitle className="text-xl">{route.label}</CardTitle>
                      <div className="rounded-full border bg-background p-2 text-muted-foreground transition-colors group-hover:text-foreground">
                        <ArrowRightIcon className="size-4" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm">
                      {route.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </InternalLink>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>System Info</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {data?.map((item) => (
                  <TableRow key={item.title}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell className="text-right">{item.value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
