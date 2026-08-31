import { type SessionMessageDataPart } from "@instrument-org/workspace/client";

export function ModelChangeNote({
  data,
}: {
  data: SessionMessageDataPart.ModelChangeDataPart;
}) {
  return (
    <div className="my-4 w-full px-4 text-center text-xs text-balance text-muted-foreground">
      Switched model from {displayName(data.from)} to{" "}
      <span className="font-medium text-muted-foreground">
        {displayName(data.to)}
      </span>
    </div>
  );
}

/**
 * The turn where the task started asking a different model.
 *
 * Centered across the column rather than beside a message. What it marks is a
 * boundary in the conversation, and everything after it is answered by a
 * different model, so it belongs between two turns rather than attached to
 * either. Right-aligning it under the user's turn, where the other slim notes
 * sit, read as something the user had attached to that message.
 *
 * A sentence rather than a diagram. An arrow between two names is a shape the
 * reader has to decode before it says anything, and it invites being read as a
 * control; ordinary words are read at a glance and cannot be mistaken for
 * something to operate.
 *
 * Shown to everyone rather than kept for developer mode, unlike the rollover
 * that sits beside it. A rollover has no faithful short description that is not
 * a description of our request assembly; this one has an obvious one, because
 * the model the user picked is a thing the user picked. It reads as a note
 * about their own action rather than as an admission about ours.
 *
 * Each side shows the display name recorded with the change, falling back to
 * the id when there is none. The name is what the user chose the model by, so
 * it is what they recognize; the id is what survives when a name was never
 * stored, and an id is still better than an empty space where a model should
 * be.
 *
 * Trimmed, because the gateway's names arrive with a leading space and this is
 * a sentence rather than a table cell: untrimmed they read as "from  Auto to
 * Gemini", with the gap visible mid-line. `ModelPicker` trims the same field
 * for the same reason.
 */
function displayName(side: { modelId: string; name?: string }): string {
  return side.name?.trim() || side.modelId;
}
