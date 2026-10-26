import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { ModelMakerIcon } from "@/client/components/model-maker-icon";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { RadioGroup } from "@/client/components/ui/radio-group";
import { Spinner } from "@/client/components/ui/spinner";
import { connectionsOf } from "@/client/lib/model-picker-rows";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import { OUR_MODELS } from "@instrument-org/shared";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ModelGroupLabel, ModelRow } from "../kit/model-row";
import { SetupFooter, SetupPage } from "../kit/setup-page";
import { type LastConnection, lastConnection } from "../last-connection";
import {
  choosableModels,
  isShortList,
  longListGroups,
  makerOf,
  modelsOfConnection,
  recommendedModel,
  shortList,
} from "../model-choices";
import { type SetupStepProps } from "../step-props";

/** How long the list may load before Continue becomes a skip. */
const SLOW_LIST_MS = 10_000;

const LATER =
  "We'll use the one you pick for new chats, and you can change it any time.";

export const MAIN_MODEL_TITLE = "Pick your main model";

/**
 * The main model (frames 04, 28 and 29): every model the connections list,
 * as one short list or, past a few, a searchable box that opens on
 * suggestions. The recommended row is what the default would have been, and
 * Continue makes the one picked the default.
 */
export function ModelStep({ onBack, onContinue }: SetupStepProps) {
  const [connection] = useState(lastConnection);
  const choice = useMainModelChoice(connection);
  return (
    <SetupPage
      footer={
        <SetupFooter
          next={
            choice.isLoading
              ? "off"
              : choice.models.length === 0
                ? "quiet"
                : "primary"
          }
          onBack={onBack}
          onContinue={() => {
            choice.save(onContinue);
          }}
          pending={choice.isSaving}
        />
      }
      subtitle={choice.subtitle}
      title={MAIN_MODEL_TITLE}
    >
      <MainModelList choice={choice} className="mt-7" />
    </SetupPage>
  );
}

type MainModelChoice = ReturnType<typeof useMainModelChoice>;

/**
 * The main model's choice, wherever it is asked (setup's model step, the
 * Add a provider sheet once a provider connects): the models to pick from
 * (the connection setup just made, when `connection` names one),
 * the one recommended and the one picked, the line under the title, and
 * `save`, which makes the one picked the default for new chats.
 */
export function useMainModelChoice(connection?: LastConnection) {
  const { data: list, isLoading } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const { data: defaultURI, isPending: isDefaultPending } = useQuery(
    rpcClient.preferences.live.defaultModelURI.experimental_liveOptions(),
  );
  const { isPending, mutate: saveDefault } = useMutation(
    rpcClient.preferences.setDefaultModelURI.mutationOptions(),
  );
  // The default as the choice opened, read once: saving the pick makes it
  // the default, which must not make it Recommended or move it to the top.
  const [entry, setEntry] = useState<{ defaultURI: typeof defaultURI }>();
  if (entry === undefined && !isDefaultPending) {
    setEntry({ defaultURI });
  }
  // A list still loading after a while offers a way on, so it never traps.
  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsSlow(true);
    }, SLOW_LIST_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  const choosable = choosableModels(list?.models ?? []);
  const own = modelsOfConnection(choosable, connection);
  // The connection's models list a moment after it connects, so the list
  // waits for them, and offers every connection's once it is slow.
  const isWaitingOnOwn = connection !== undefined && own.length === 0;
  const models = isWaitingOnOwn && isSlow ? choosable : own;
  const recommended = recommendedModel(models, entry?.defaultURI);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const chosen = picked ?? recommended?.uri;
  const isShort = isShortList(models);

  const connections = connectionsOf(models);
  const [only] = connections;
  const subtitle =
    connections.length === 1 && only?.isOurs
      ? `Your plan includes all of these. ${LATER}`
      : connections.length === 1 && only
        ? `${only.name} is connected${isShort ? "" : `, with ${String(models.length)} models ready`}. ${LATER}`
        : LATER;

  /** Makes the one picked the default, then `onDone`. */
  const save = (onDone: () => void) => {
    const model = models.find((candidate) => candidate.uri === chosen);
    if (!model) {
      // Nothing listed to pick from: moving on leaves the default as it is.
      onDone();
      return;
    }
    saveDefault({ modelURI: model.uri }, { onSuccess: onDone });
  };

  return {
    chosen,
    isLoading: isLoading || (isWaitingOnOwn && !isSlow),
    isSaving: isPending,
    isShort,
    isSlow,
    models,
    recommended,
    save,
    setPicked,
    subtitle,
  };
}

/** The models to pick the main one from, as one short list or the searchable box. */
export function MainModelList({
  choice,
  className,
}: {
  choice: MainModelChoice;
  className?: string;
}) {
  const { chosen, isLoading, isShort, isSlow, models, recommended } = choice;
  const rowProps = (model: AIGatewayModel.Type) => ({
    icon: <ModelIcon model={model} />,
    id: `setup-model-${model.uri}`,
    isRecommended: model === recommended,
    isSelected: model.uri === chosen,
    name: model.name.trim(),
    sub: model.family,
    value: model.uri,
  });
  return (
    <RadioGroup
      aria-label="Main model"
      className={cn("grid-cols-[minmax(0,1fr)] gap-0", className)}
      onValueChange={choice.setPicked}
      value={chosen ?? ""}
    >
      {isLoading && !isSlow ? (
        <div className="flex h-24 w-140 max-w-full items-center justify-center rounded-2xl border bg-card">
          <Spinner />
        </div>
      ) : models.length === 0 ? (
        <p className="w-140 max-w-full rounded-2xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          Your models haven't loaded yet. You can pick one later in the reply
          box.
        </p>
      ) : isShort ? (
        <div className="flex w-140 max-w-full flex-col rounded-2xl border bg-card p-2">
          {shortList(models, recommended).map((model, index, shown) => (
            <div key={model.uri}>
              {/* A rule between rows, left blank beside the picked one,
                whose own fill sets it apart. */}
              {index > 0 && (
                <div
                  className={cn(
                    "ml-13 h-px",
                    model.uri !== chosen &&
                      shown[index - 1]?.uri !== chosen &&
                      "bg-gray-100 dark:bg-white/5",
                  )}
                />
              )}
              <ModelRow {...rowProps(model)} />
            </div>
          ))}
        </div>
      ) : (
        <LongList
          count={models.length}
          groups={(query) => longListGroups({ models, query, recommended })}
          rowProps={rowProps}
        />
      )}
    </RadioGroup>
  );
}

/** Frame 28's box: search across the top, and the groups scrolling under it. */
function LongList({
  count,
  groups,
  rowProps,
}: {
  count: number;
  groups: (query: string) => ReturnType<typeof longListGroups>;
  rowProps: (model: AIGatewayModel.Type) => Parameters<typeof ModelRow>[0];
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // The search chord takes this page's search, as it takes the app's own.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "l"
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  const shown = groups(query);
  return (
    <div className="flex h-95 w-140 max-w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="border-b border-gray-100 p-2 dark:border-white/5">
        <InputGroup className="rounded-lg bg-black/5 bg-none shadow-none dark:bg-white/5">
          <InputGroupAddon>
            <MagnifyingGlassIcon className="text-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search models"
            className="bg-none text-sm placeholder:text-gray-400"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder={`Search ${String(count)} models`}
            ref={searchRef}
            value={query}
          />
        </InputGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No models match “{query.trim()}”.
          </p>
        ) : (
          shown.map((group) => (
            <div key={group.label}>
              <ModelGroupLabel>{group.label}</ModelGroupLabel>
              {group.models.map((model) => (
                <ModelRow key={model.uri} {...rowProps(model)} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ModelIcon({ model }: { model: AIGatewayModel.Type }) {
  return model.providerId === OUR_MODELS.text.id ? (
    <AIProviderIcon colored type={OUR_MODELS.providerType} />
  ) : (
    <ModelMakerIcon author={makerOf(model)} />
  );
}
