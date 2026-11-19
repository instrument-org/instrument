import { ModelNoticeRow } from "@/client/components/model-notice";
import { noticeFor, readModelStatus } from "@/client/lib/model-status";
import { modelStatusScenarios } from "@/client/lib/model-status-scenarios";
import { toast } from "@/client/lib/toast";

import { DebugState } from "../-shell";
import { type NoticesStateId, noticesStatesOn } from "../-states/notices";

/**
 * Widths the row is drawn at: the composer at its narrowest beside a chat,
 * and at its usual width, since the longer notices wrap at the first.
 */
const WIDTHS = [
  { label: "Narrow", px: 360 },
  { label: "Composer", px: 640 },
];

/**
 * The scenario each state draws. A scenario added to the shared list needs a
 * state here and in `noticesStates` to be drawn.
 */
const scenarioOf = {
  "claude-account-signed-out": "Claude account signed out",
  fine: "fine",
  "list-failed": "the list failed",
  loading: "loading",
  "newer-release": "newer release listed",
  "newer-release-dismissed": "newer release, offer dismissed",
  "none-chosen": "none chosen",
  "nothing-listed": "nothing listed",
  "other-computer-other-kind":
    "another computer's connection, only another kind here",
  "other-computer-same-kind":
    "another computer's connection, one of the kind here",
  "provider-failed": "its provider failed to load",
  "provider-off-same-model": "provider turned off, same model elsewhere",
  "provider-removed-instrument-first":
    "provider removed, same model through OpenRouter and Instrument",
  "provider-removed-same-model": "provider removed, same model elsewhere",
  "restricted-auto-fallback": "restricted, with Auto to fall back on",
  "withdrawn-nothing-continues": "withdrawn, nothing continues it",
  "withdrawn-series-continues": "withdrawn, its series continues",
} satisfies Record<
  NoticesStateId<"model-notices">,
  keyof typeof modelStatusScenarios
>;

/**
 * Every notice the row over the composer can show, read through the same
 * status code the composer uses, from the scenarios the unit test pins.
 */
export function ModelNotices() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-8">
      <p className="text-sm text-muted-foreground">
        The row above the composer for each state the chosen model can be in, at
        its narrowest and at its usual width. States with nothing to say show no
        row.
      </p>
      {noticesStatesOn("model-notices").map((state) => {
        const status = readModelStatus(
          modelStatusScenarios[scenarioOf[state.id]],
        );
        const notice = noticeFor(status);
        return (
          <DebugState
            className="flex flex-col gap-3"
            id={state.id}
            key={state.id}
          >
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium">{state.label}</h2>
              <code className="text-xs text-muted-foreground">
                {status.kind}
              </code>
            </div>
            {notice ? (
              <div className="flex flex-wrap items-start gap-6">
                {WIDTHS.map((width) => (
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
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No row.</p>
            )}
          </DebugState>
        );
      })}
    </div>
  );
}
