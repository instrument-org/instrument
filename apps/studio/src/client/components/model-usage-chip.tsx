import { sift } from "radashi";

import { modelName, type ModelUsage } from "../lib/models-answered";
import { cn } from "../lib/utils";
import { ModelChip } from "./model-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The model a run of replies asked for, as a chip whose card says what
 * answered: the router's pick, a provider's substitute, the ids.
 */
export function ModelUsageChip({
  className,
  usage,
}: {
  className?: string;
  usage: ModelUsage;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="min-w-0">
          <ModelChip
            aiGatewayModel={usage.requested}
            className={className}
            modelId={usage.modelId}
            replacedBy={substitutedBy(usage)}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent align="start" className="p-3 text-xs" side="top">
        <div className="space-y-2">
          {getModelInfoRows(usage).map((row, rowIndex) => (
            <TooltipRow key={`${row.label}-${rowIndex}`} {...row} />
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function TooltipRow({
  label,
  tabular,
  value,
}: {
  label: string;
  tabular?: boolean;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="opacity-80">{label}</span>
      <span className={cn("font-medium", { "tabular-nums": tabular })}>
        {value}
      </span>
    </div>
  );
}

/**
 * The card behind a model chip.
 *
 * A routed turn has no `Model` row. The router is already named in the label of
 * the row below it -- and in the chip this card opens from -- so a `Model` row
 * would name it twice while disagreeing with the `Model ID` row underneath,
 * which carries the id of the model that actually answered.
 */
function getModelInfoRows(usage: ModelUsage): {
  label: string;
  value: string;
}[] {
  const { requested, served } = usage;
  const [firstAnswered, ...otherAnswered] = served;

  const identity =
    usage.kind === "routed" && requested
      ? // Reads as one sentence across the label and its value: "Auto chose
        // GPT-5.6 Luna". The router's own name rather than the word Auto, so a
        // router we have never heard of needs no case of its own.
        served.map((model, index) => ({
          label: index === 0 ? `${requested.name.trim()} chose:` : "",
          value: modelName(model),
        }))
      : sift([
          {
            label: "Model:",
            value: firstAnswered
              ? modelName(firstAnswered)
              : (requested?.name ?? usage.modelId),
          },
          ...otherAnswered.map((model) => ({
            label: "",
            value: modelName(model),
          })),
          usage.kind === "substituted" &&
            requested && {
              label: "You asked for:",
              value: requested.name,
            },
        ]);

  return sift([
    ...identity,
    requested?.params.provider && {
      label: "Provider:",
      value: requested.params.provider,
    },
    // Only where the id says something the name above it did not. A model the
    // catalog has no record of is displayed by its id already, so an id row
    // there is the same string twice.
    ...identifyingIds(
      firstAnswered
        ? served.map((model) => ({
            name: modelName(model),
            providerId: model.providerId,
          }))
        : sift([
            requested && {
              name: requested.name,
              providerId: requested.providerId,
            },
          ]),
    ),
  ]);
}

function identifyingIds(
  shown: { name: string; providerId: string }[],
): { label: string; value: string }[] {
  return shown
    .filter((model) => model.name !== model.providerId)
    .map((model, index) => ({
      label: index === 0 ? "Model ID:" : "",
      value: model.providerId,
    }));
}

/**
 * The model that answered instead, on a turn where one did. Absent on a routed
 * turn, where a different answer is the router doing its job rather than
 * something being replaced.
 */
function substitutedBy(usage: ModelUsage): string | undefined {
  if (usage.kind !== "substituted") {
    return;
  }
  const [first] = usage.served;
  return first && modelName(first);
}
