import { providerMetadataAtom } from "@/client/atoms/provider-metadata";
import { AddProviderForm } from "@/client/components/add-provider/form";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { ExternalLink } from "@/client/components/external-link";
import { ModelMakerIcon } from "@/client/components/model-maker-icon";
import {
  ConnectedChip,
  SetupGroup,
  SetupHead,
  SetupPage,
  SetupRow,
} from "@/client/components/onboarding/setup/chrome";
import { useSetup } from "@/client/components/onboarding/setup/context";
import {
  KEY_PROVIDERS,
  maskKey,
  pickMainModels,
} from "@/client/components/onboarding/setup/own-key-models";
import { Input } from "@/client/components/ui/input";
import { Spinner } from "@/client/components/ui/spinner";
import { Switch } from "@/client/components/ui/switch";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import {
  type AIProviderConfigId,
  type AIProviderType,
} from "@instrument-org/shared";
import { ORPCError } from "@orpc/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { LockIcon } from "@phosphor-icons/react/Lock";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** How long typing pauses before the key is checked. A paste checks at once. */
const TYPED_KEY_PAUSE_MS = 600;

/** F24: the providers most people have keys for. */
export function ProvidersPage() {
  const { dispatch, state } = useSetup();
  const { providerMetadataMap } = useAtomValue(providerMetadataAtom);
  const [showAll, setShowAll] = useState(false);

  if (showAll) {
    return <AllProviders onBack={() => setShowAll(false)} />;
  }

  return (
    <SetupPage>
      <SetupHead
        subtitle="Use a key from an AI company you already pay. They bill you directly."
        title="Add an API provider"
      />
      <div className="mt-8 grid w-140 grid-cols-3 gap-3">
        {KEY_PROVIDERS.map((type) => (
          <ProviderTile
            key={type}
            label={providerMetadataMap.get(type)?.name ?? type}
            mark={
              <AIProviderIcon className="size-9" colored company type={type} />
            }
            onClick={() => {
              const { keyProvider, providerId } = state.answers;
              if (providerId && keyProvider !== type) {
                // Setup saved a key for another provider; this pick replaces it.
                void rpcClient.providerConfig.remove
                  .call({ id: providerId })
                  .catch(() => {});
                dispatch({ answers: { providerId: null }, type: "answer" });
              }
              dispatch({ answers: { keyProvider: type }, type: "answer" });
              dispatch({ step: "paste-key", type: "go" });
            }}
          />
        ))}
        <ProviderTile
          dashed
          label="More providers"
          mark={
            <DotsThreeIcon
              className="size-7 text-foreground/60"
              weight="bold"
            />
          }
          onClick={() => {
            setShowAll(true);
          }}
        />
      </div>
    </SetupPage>
  );
}

function ProviderTile({
  dashed = false,
  label,
  mark,
  onClick,
}: {
  dashed?: boolean;
  label: string;
  mark: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-2xl px-4 py-5 transition-shadow",
        dashed
          ? "border border-dashed border-foreground/20 text-foreground/60 hover:border-foreground/35"
          : "bg-card shadow-xs ring-1 ring-black/[0.07] hover:ring-black/15 dark:ring-white/10 dark:hover:ring-white/20",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex size-12 items-center justify-center">{mark}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

/**
 * Behind "More providers": the app's whole add-provider form, so every
 * provider it knows (local ones and custom endpoints included) can be added
 * here the way Settings adds them. Its own checks run, so a saved provider
 * goes straight to choosing a model.
 */
function AllProviders({ onBack }: { onBack: () => void }) {
  const { dispatch } = useSetup();
  const { data: providers = [] } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const [knownIds] = useState(() => new Set(providers.map(({ id }) => id)));

  return (
    <SetupPage back={false} footer={false}>
      <div className="w-120 rounded-2xl bg-card p-6 shadow-xs ring-1 ring-black/[0.07] dark:ring-white/10">
        <AddProviderForm
          onBack={onBack}
          onSuccess={() => {
            void rpcClient.providerConfig.list.call().then((configs) => {
              const added = configs.find(({ id }) => !knownIds.has(id));
              if (!added) {
                return;
              }
              dispatch({
                answers: { keyProvider: added.type, providerId: added.id },
                type: "answer",
              });
              dispatch({ step: "model", type: "go" });
            });
          }}
          providers={providers}
          submitLabel="Continue"
        />
      </div>
    </SetupPage>
  );
}

type KeyStatus =
  | { kind: "accepted"; id: AIProviderConfigId }
  | { kind: "checking" }
  | { kind: "failed"; message: string }
  | { kind: "idle" }
  | { kind: "refused" };

/** F25 to F27: the key, checked as it is pasted. */
export function PasteKeyPage() {
  const { dispatch, state } = useSetup();
  const type = state.answers.keyProvider;
  const { providerMetadataMap } = useAtomValue(providerMetadataAtom);
  const metadata = type ? providerMetadataMap.get(type) : undefined;
  const { data: configs = [] } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const savedId = state.answers.providerId;
  const saved = configs.find(
    (config) => config.id === savedId && config.type === type,
  );

  const [key, setKey] = useState("");
  const [status, setStatus] = useState<KeyStatus>(() =>
    savedId ? { id: savedId, kind: "accepted" } : { kind: "idle" },
  );
  const checkCount = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const createMutation = useMutation(
    rpcClient.providerConfig.create.mutationOptions(),
  );
  const removeMutation = useMutation(
    rpcClient.providerConfig.remove.mutationOptions(),
  );

  const acceptedId = status.kind === "accepted" ? status.id : null;
  const modelCount = useProviderModels(acceptedId).length;

  if (!type || !metadata) {
    return (
      <SetupPage>
        <SetupHead title="Pick a provider first" />
      </SetupPage>
    );
  }
  const name = metadata.name;

  const check = async (candidate: string) => {
    const apiKey = candidate.trim();
    checkCount.current += 1;
    const thisCheck = checkCount.current;
    if (!apiKey) {
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "checking" });

    // A key checked earlier in setup was saved; this one replaces it.
    if (state.answers.providerId) {
      const previous = state.answers.providerId;
      dispatch({ answers: { providerId: null }, type: "answer" });
      await removeMutation.mutateAsync({ id: previous }).catch(() => {});
    }

    const existing = await rpcClient.providerConfig.list.call();
    try {
      const { id } = await createMutation.mutateAsync({
        config: {
          apiKey,
          // The form names the first provider of a type after the provider.
          displayName: existing.some((config) => config.type === type)
            ? undefined
            : name,
          type,
        },
      });
      if (thisCheck !== checkCount.current) {
        await removeMutation.mutateAsync({ id }).catch(() => {});
        return;
      }
      dispatch({ answers: { providerId: id }, type: "answer" });
      setStatus({ id, kind: "accepted" });
    } catch (error) {
      if (thisCheck !== checkCount.current) {
        return;
      }
      if (error instanceof ORPCError && error.code === "UNAUTHORIZED") {
        setStatus({ kind: "refused" });
      } else {
        setStatus({
          kind: "failed",
          message:
            error instanceof Error && error.message
              ? error.message
              : `We couldn't check this key with ${name}.`,
        });
      }
    }
  };

  const scheduleCheck = (value: string, delay: number) => {
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      void check(value);
    }, delay);
  };

  const shown =
    status.kind === "accepted"
      ? key
        ? maskKey(key)
        : (saved?.maskedApiKey ?? "")
      : key;

  return (
    <SetupPage
      next={{
        disabled: status.kind !== "accepted",
        label: "Continue",
        onClick: () => {
          dispatch({ step: "model", type: "go" });
        },
      }}
    >
      <SetupHead
        illustration={
          <div className="flex size-18 items-center justify-center rounded-2xl bg-card shadow-xs ring-1 ring-black/[0.07] dark:ring-white/10">
            <AIProviderIcon className="size-10" colored company type={type} />
          </div>
        }
        subtitle={
          <ExternalLink
            className="inline-flex items-center gap-1 text-foreground/70 underline underline-offset-3 hover:text-foreground"
            href={metadata.api.keyURL ?? metadata.url}
          >
            Get a key from {name}
            <ArrowUpRightIcon className="size-3.5" />
          </ExternalLink>
        }
        title={`Paste your ${name} API key`}
      />
      <div className="mt-8 flex w-130 flex-col gap-3">
        <Input
          aria-invalid={status.kind === "refused" || status.kind === "failed"}
          autoFocus
          className={cn(
            "h-12 rounded-xl bg-card px-4 font-mono text-[13px] md:text-[13px]",
            status.kind === "refused" &&
              "border-destructive/60 ring-2 ring-destructive/20",
          )}
          onChange={(event) => {
            const value = event.target.value;
            if (status.kind === "accepted" && /[•·]/.test(value)) {
              // Editing the masked key starts over with an empty field.
              setKey("");
              setStatus({ kind: "idle" });
              return;
            }
            setKey(value);
            if (status.kind !== "checking") {
              setStatus({ kind: "idle" });
            }
            scheduleCheck(value, TYPED_KEY_PAUSE_MS);
          }}
          onFocus={(event) => {
            if (status.kind === "accepted") {
              event.target.select();
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (pasted.trim()) {
              event.preventDefault();
              setKey(pasted.trim());
              scheduleCheck(pasted, 0);
            }
          }}
          placeholder={`${metadata.api.keyFormat ?? ""}…`}
          spellCheck={false}
          type="text"
          value={shown}
        />
        <KeyStatusLine
          modelCount={modelCount}
          name={name}
          onRetry={() => {
            void check(key);
          }}
          status={status}
        />
      </div>
    </SetupPage>
  );
}

function KeyStatusLine({
  modelCount,
  name,
  onRetry,
  status,
}: {
  modelCount: number;
  name: string;
  /** Checks the same key again, for a check that could not reach the provider. */
  onRetry: () => void;
  status: KeyStatus;
}) {
  switch (status.kind) {
    case "accepted":
      return (
        <p className="flex items-center gap-2 text-[13px] text-foreground/70">
          <CheckCircleIcon
            className="size-4 text-brand-600 dark:text-brand-400"
            weight="fill"
          />
          {modelCount > 0
            ? `It works. ${modelCount} ${modelCount === 1 ? "model is" : "models are"} ready.`
            : "It works. We're getting its models ready."}
        </p>
      );
    case "checking":
      return (
        <p className="flex items-center gap-2 text-[13px] text-foreground/55">
          <Spinner className="size-3.5" />
          Checking the key with {name}…
        </p>
      );
    case "failed":
      return (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          <WarningCircleIcon className="size-4 shrink-0" weight="fill" />
          {status.message}
          <button
            className="font-medium text-foreground/70 underline underline-offset-2 hover:text-foreground"
            onClick={onRetry}
            type="button"
          >
            Try again
          </button>
        </p>
      );
    case "refused":
      return (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          <WarningCircleIcon className="size-4 shrink-0" weight="fill" />
          {name} didn't accept this key. Check that you copied all of it.
        </p>
      );
    case "idle":
      return (
        <p className="flex items-center gap-2 text-[13px] text-foreground/50">
          <LockIcon className="size-3.5" />
          Your API key is encrypted and stored on your device
        </p>
      );
  }
}

/** The models a saved provider config offers, as the model picker sees them. */
function useProviderModels(
  providerId: AIProviderConfigId | null,
): AIGatewayModel.Type[] {
  const { data } = useQuery({
    ...rpcClient.gateway.models.live.list.experimental_liveOptions(),
    enabled: providerId !== null,
  });
  if (!providerId) {
    return [];
  }
  return (data?.models ?? []).filter(
    (model) => model.params.providerConfigId === providerId,
  );
}

/** How long the model list loads before it is said to be missing. */
const MODEL_LIST_LATE_AFTER = 10_000;

/** F28: the main model, and whether setup may spend the key. */
export function ModelPage() {
  const { dispatch, state } = useSetup();
  const providerId = state.answers.providerId;
  const { providerMetadataMap } = useAtomValue(providerMetadataAtom);
  const { data: configs = [] } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const config = configs.find(({ id }) => id === providerId);
  const type: AIProviderType | null = config?.type ?? state.answers.keyProvider;
  const name =
    config?.displayName ??
    (type ? providerMetadataMap.get(type)?.name : undefined) ??
    "Your provider";

  const models = useProviderModels(providerId);
  const picks = pickMainModels(models);
  // A list that has not come in after a while is said to be missing, with a
  // way on that keeps the model new chats already use.
  const [isListLate, setIsListLate] = useState(false);
  const hasModels = picks.length > 0;
  useEffect(() => {
    if (hasModels) {
      return;
    }
    const late = setTimeout(() => {
      setIsListLate(true);
    }, MODEL_LIST_LATE_AFTER);
    return () => {
      clearTimeout(late);
    };
  }, [hasModels]);
  const moveOn = () => {
    dispatch({ type: "way", way: "key" });
    dispatch({ step: "free-account", type: "go" });
  };
  const rest = models
    .filter((model) => !picks.some((pick) => pick.model.uri === model.uri))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const [chosen, setChosen] = useState<AIGatewayModel.Type["uri"] | null>(null);
  const selected = chosen ?? picks[0]?.model.uri ?? null;
  const [showAll, setShowAll] = useState(false);

  const saveDefault = useMutation(
    rpcClient.preferences.setDefaultModelURI.mutationOptions(),
  );

  return (
    <SetupPage
      next={{
        disabled: !selected || saveDefault.isPending,
        label: "Continue",
        onClick: () => {
          if (!selected) {
            return;
          }
          saveDefault.mutate({ modelURI: selected }, { onSuccess: moveOn });
        },
      }}
      skip={!hasModels && isListLate ? { onClick: moveOn } : undefined}
    >
      <ConnectedChip
        icon={
          type ? (
            <AIProviderIcon className="size-4" colored company type={type} />
          ) : undefined
        }
        label={
          models.length > 0
            ? `${name} · ${models.length} ${models.length === 1 ? "model" : "models"} ready`
            : name
        }
      />
      <SetupHead
        subtitle="We'll use it for new chats. You can change it any time, in Settings or in any chat."
        title="Pick your main model"
      />
      <div className="mt-8 flex flex-col items-center gap-4">
        <SetupGroup>
          <div aria-label="Main model" role="radiogroup">
            {!hasModels &&
              (isListLate ? (
                <SetupRow
                  detail="You can skip this and pick a model later, in Settings or in any chat."
                  icon={
                    <WarningCircleIcon className="size-4 text-foreground/50" />
                  }
                  title={`We couldn't load ${name}'s models`}
                />
              ) : (
                <SetupRow
                  icon={<Spinner className="size-4" />}
                  title="Loading the models…"
                />
              ))}
            {picks.map((pick) => (
              <ModelRow
                checked={selected === pick.model.uri}
                detail={pick.detail}
                key={pick.model.uri}
                model={pick.model}
                onSelect={() => {
                  setChosen(pick.model.uri);
                }}
                recommended={pick.recommended}
              />
            ))}
            {showAll &&
              rest.map((model) => (
                <ModelRow
                  checked={selected === model.uri}
                  key={model.uri}
                  model={model}
                  onSelect={() => {
                    setChosen(model.uri);
                  }}
                />
              ))}
          </div>
          {!showAll && rest.length > 0 && (
            <button
              className="flex w-full items-center gap-3.5 border-t border-foreground/[0.07] px-4 py-3 text-left text-sm font-medium text-foreground/60 hover:text-foreground/80"
              onClick={() => {
                setShowAll(true);
              }}
              type="button"
            >
              <span className="flex size-8 items-center justify-center">
                <CaretDownIcon className="size-4" weight="bold" />
              </span>
              Show all {models.length} models
            </button>
          )}
        </SetupGroup>
        <SetupGroup>
          <SetupRow
            control={
              <Switch
                checked={state.answers.useAIDuringSetup}
                onCheckedChange={(checked) => {
                  dispatch({
                    answers: { useAIDuringSetup: checked },
                    type: "answer",
                  });
                }}
              />
            }
            detail="To write a few task ideas for you. It costs a cent or two."
            icon={
              <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600/10 text-brand-700 dark:text-brand-300">
                <SparkleIcon className="size-4.5" weight="fill" />
              </span>
            }
            title="Use it during setup"
          />
        </SetupGroup>
      </div>
    </SetupPage>
  );
}

function ModelRow({
  checked,
  detail,
  model,
  onSelect,
  recommended = false,
}: {
  checked: boolean;
  detail?: string;
  model: AIGatewayModel.Type;
  onSelect: () => void;
  recommended?: boolean;
}) {
  return (
    <button
      aria-checked={checked}
      className="flex w-full items-center gap-3.5 border-t border-foreground/[0.07] px-4 py-3 text-left first:border-t-0 hover:bg-foreground/[0.02]"
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          checked
            ? "border-brand-600 bg-brand-600"
            : "border-foreground/25 bg-card",
        )}
      >
        {checked && <span className="size-2 rounded-full bg-white" />}
      </span>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card ring-1 ring-black/[0.06] dark:ring-white/10">
        <ModelMakerIcon author={model.author} className="size-4.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {model.name}
          </span>
          {recommended && (
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
              Recommended
            </span>
          )}
        </span>
        {detail && <span className="text-xs text-foreground/50">{detail}</span>}
      </span>
    </button>
  );
}
