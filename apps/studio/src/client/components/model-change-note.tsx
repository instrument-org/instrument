import { type SessionMessageDataPart } from "@instrument-org/workspace/client";

import { type ModelSide } from "../lib/chat-separators";
import { ModelUsageChip, RecordedModelChip } from "./model-usage-chip";

/**
 * The turn where the chat started asking a different model, on a line of its
 * own across the column: what it marks is a boundary in the conversation, so
 * it belongs between two turns rather than attached to either.
 *
 * Above a message the person sent, the switch is drawn by the separator over
 * it (`ChatSeparatorRow`), which this line would only repeat. This one is for
 * the switch nothing sits over: a failed reply asked again on another model,
 * and a turn the app started, such as a finished task's.
 */
export function ModelChangeNote({
  data,
}: {
  data: SessionMessageDataPart.ModelChangeDataPart;
}) {
  return (
    <div className="flex w-full justify-center py-2 text-xs text-muted-foreground opacity-50">
      <ModelSwitch from={{ recorded: data.from }} to={{ recorded: data.to }} />
    </div>
  );
}

/**
 * A switch of model as a sentence with the two models in it, each drawn the
 * way every model in the chat is. Ordinary words read at a glance where an
 * arrow between two names is a shape to decode first.
 */
export function ModelSwitch({ from, to }: { from: ModelSide; to: ModelSide }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
      Switched from <SideChip side={from} /> to <SideChip side={to} />
    </span>
  );
}

function SideChip({ side }: { side: ModelSide }) {
  return side.usage ? (
    <ModelUsageChip usage={side.usage} />
  ) : (
    <RecordedModelChip model={side.recorded} />
  );
}
