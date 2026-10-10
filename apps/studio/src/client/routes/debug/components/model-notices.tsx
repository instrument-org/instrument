import { ModelNoticeRow } from "@/client/components/model-notice";
import { noticeFor, readModelStatus } from "@/client/lib/model-status";
import { modelStatusScenarios } from "@/client/lib/model-status-scenarios";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "@/client/lib/toast";

export const Route = createFileRoute("/debug/components/model-notices")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug model notices" }],
  }),
});

/**
 * Widths the row is drawn at: the composer at its narrowest beside a chat,
 * and at its usual width, since the longer notices wrap at the first.
 */
const WIDTHS = [
  { label: "Narrow", px: 360 },
  { label: "Composer", px: 640 },
];

/**
 * Every notice the row over the composer can show, read through the same
 * status code the composer uses, from the scenarios the unit test pins.
 */
function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Components
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Model notices
          </h1>
          <p className="text-sm text-muted-foreground">
            The row above the composer for each state the chosen model can be
            in. States with nothing to say show no row.
          </p>
        </header>

        {Object.entries(modelStatusScenarios).map(([name, input]) => {
          const status = readModelStatus(input);
          const notice = noticeFor(status);
          return (
            <section className="flex flex-col gap-3" key={name}>
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-medium">{name}</h2>
                <code className="text-xs text-muted-foreground">
                  {status.kind}
                </code>
              </div>
              {notice ? (
                WIDTHS.map((width) => (
                  <div className="flex flex-col gap-1" key={width.label}>
                    <p className="text-xs text-muted-foreground">
                      {width.label}, {width.px}px
                    </p>
                    <div style={{ width: width.px }}>
                      <ModelNoticeRow
                        notice={notice}
                        onAction={(action) => {
                          toast(action.label);
                        }}
                        onDismiss={() => {
                          toast("Dismissed");
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No row.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
