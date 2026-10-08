import { openSettings } from "@/client/atoms/settings-modal";
import { Button } from "@/client/components/ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { captureClientEvent } from "@/client/lib/capture-client-event";
import {
  type Connection,
  connectionsOf,
  isFoldedAway,
  type PickerRow,
  rowsForConnection,
  rowsForSearch,
} from "@/client/lib/model-picker-rows";
import { type ModelAction, type ModelNotice } from "@/client/lib/model-status";
import { cn } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import {
  type AIGatewayModel,
  type AIGatewayModelURI,
  modelNameFromURI,
  readModelURI,
} from "@instrument-org/ai-gateway/client";
import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type PointerEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AIProviderIcon } from "./ai-provider-icon";
import { FuzzyHighlight } from "./fuzzy-highlight";
import { ModelMakerIcon } from "./model-maker-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The size the panel asks for before the window has a say: a rail of
 * connections and a list wide enough to read a model's name and the line
 * under it, and tall enough that a provider's list reads as a list. Fixed
 * rather than fitted to the list, so moving between connections does not
 * resize the panel under the pointer.
 */
const PANEL_WIDTH = "42.5rem";
const PANEL_HEIGHT = "32.5rem";

/** The chosen model's row, the same pressed state the inbox's filters use. */
const CHOSEN = "bg-accent text-accent-foreground";

type ListError = NonNullable<
  RPCOutput["gateway"]["models"]["list"]["errors"]
>[number];

/** A connection as the rail shows it: one that listed models, or one whose list failed. */
type RailEntry = Connection & { failed?: ListError };

export function ModelPicker({
  align = "start",
  anchorOnly = false,
  className = "",
  disabled = false,
  errors,
  isError = false,
  isLoading = false,
  models,
  modelURI,
  notice,
  onAction,
  onAddProvider,
  onClose,
  onOpenChange,
  onValueChange,
  open: openProp,
  placeholder = "Select a model",
  selectedModel,
}: {
  /** Which edge of the trigger the panel lines up with: the end for a trigger at the right of its row. */
  align?: "end" | "start";
  /**
   * Render no button of its own: the panel hangs off an empty box the caller
   * places, for a surface that offers the picker from a menu instead.
   *
   * Not the same as hiding the button, which is what this replaced. A trigger
   * held at `opacity-0` keeps its place in the tab order, is announced as a
   * combobox over whatever it covers, and paints at half opacity the moment it
   * is disabled, since `disabled:opacity-50` outranks a plain `opacity-0`.
   */
  anchorOnly?: boolean;
  className?: string;
  disabled?: boolean;
  errors?: ListError[];
  isError?: boolean;
  isLoading?: boolean;
  models?: AIGatewayModel.Type[];
  /** The current selection, which the models list may no longer resolve. */
  modelURI?: AIGatewayModelURI.Type;
  /** What the composer is saying about the chosen model, repeated over the list. */
  notice?: ModelNotice | null;
  onAction?: (action: ModelAction) => void;
  onAddProvider?: () => void;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  onValueChange: (value: AIGatewayModelURI.Type) => void;
  /** Open from outside, for a surface that offers the picker from a menu rather than its own button. */
  open?: boolean;
  placeholder?: string;
  selectedModel?: AIGatewayModel.Type;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = openProp ?? open;

  const closePopover = () => {
    setOpen(false);
    onClose?.();
  };

  const isProblem = notice?.tone === "problem";
  const selectedName =
    selectedModel?.name.trim() ??
    (modelURI ? (modelNameFromURI(modelURI) ?? null) : null);
  const placeholderText = isLoading
    ? "Loading models..."
    : isError
      ? "Couldn't load models"
      : models?.length
        ? placeholder
        : "No models available";

  return (
    <Popover
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          captureClientEvent("model_picker.opened");
        } else {
          closePopover();
        }
        onOpenChange?.(next);
      }}
      open={isOpen}
    >
      {anchorOnly ? (
        <PopoverAnchor className={className} />
      ) : (
        <PopoverTrigger asChild>
          <Button
            aria-expanded={isOpen}
            aria-label="Model"
            className={cn(
              "flex h-auto max-w-full items-center justify-between gap-2 rounded-lg px-1.5! py-1 text-left",
              "text-gray-400 hover:text-gray-400 dark:text-gray-500 dark:hover:text-gray-500",
              isProblem &&
                "text-yellow-700 hover:text-yellow-700 dark:text-yellow-300 dark:hover:text-yellow-300",
              className,
            )}
            disabled={disabled || isLoading}
            role="combobox"
            size="sm"
            variant="ghost"
          >
            {selectedName ? (
              <span className="flex min-w-0 items-center gap-2 text-xs leading-4 font-medium">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex shrink-0">
                      {selectedModel && !isProblem ? (
                        <AIProviderIcon
                          className="size-4"
                          type={selectedModel.params.provider}
                        />
                      ) : (
                        <WarningIcon className="size-4" />
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {isProblem ? notice.text : selectedModel?.providerName}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <span className="min-w-0 flex-1 truncate">{selectedName}</span>
              </span>
            ) : (
              <span className="text-xs leading-4 font-medium opacity-50">
                {placeholderText}
              </span>
            )}
            <CaretDownIcon className="size-3 shrink-0" />
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent
        align={align}
        className="flex flex-col p-0"
        maxHeight={PANEL_HEIGHT}
        style={{
          height: PANEL_HEIGHT,
          maxWidth: "var(--radix-popover-content-available-width)",
          width: PANEL_WIDTH,
        }}
      >
        {isOpen && (
          <PickerPanel
            errors={errors ?? []}
            isError={isError}
            models={models ?? []}
            modelURI={modelURI}
            notice={notice}
            onAction={(action) => {
              onAction?.(action);
              if (action.kind !== "retry") {
                closePopover();
              }
            }}
            onAddProvider={() => {
              closePopover();
              onAddProvider?.();
            }}
            onPick={(model) => {
              captureClientEvent("model_picker.model_selected", {
                modelId: model.canonicalId,
                providerId: model.params.provider,
              });
              onValueChange(model.uri);
              closePopover();
            }}
            selectedModel={selectedModel}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The panel's insides, mounted only while it is open, so each opening starts
 * on the chosen model's connection with an empty search.
 */
function PickerPanel({
  errors,
  isError,
  models,
  modelURI,
  notice,
  onAction,
  onAddProvider,
  onPick,
  selectedModel,
}: {
  errors: ListError[];
  isError: boolean;
  models: AIGatewayModel.Type[];
  modelURI?: AIGatewayModelURI.Type;
  notice?: ModelNotice | null;
  onAction: (action: ModelAction) => void;
  onAddProvider: () => void;
  onPick: (model: AIGatewayModel.Type) => void;
  selectedModel?: AIGatewayModel.Type;
}) {
  const listed = connectionsOf(models);
  const rail: RailEntry[] = [
    ...listed,
    // A connection whose list failed lists nothing, so it would vanish from
    // the rail at the moment it most needs explaining.
    ...errors
      .filter((error) => !listed.some((entry) => entry.id === error.config.id))
      .map((error) => ({
        failed: error,
        id: error.config.id,
        isOurs: error.config.type === OUR_MODELS.providerType,
        name: error.config.displayName ?? error.config.type,
        provider: error.config.type,
      })),
  ];

  const chosenConnection =
    selectedModel?.params.providerConfigId ??
    (modelURI ? readModelURI(modelURI)?.providerConfigId : undefined);
  const [openId, setOpenId] = useState(
    () =>
      rail.find((entry) => entry.id === chosenConnection)?.id ?? rail[0]?.id,
  );
  const [query, setQuery] = useState("");
  // A chosen model the recommendations leave out opens the whole list,
  // since the picker's first answer is what is chosen.
  const [showAll, setShowAll] = useState(
    () =>
      selectedModel !== undefined &&
      selectedModel.params.providerConfigId === openId &&
      isFoldedAway(models, selectedModel),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // cmdk always lights an item, the first if nothing else, so a panel that
  // had not been touched opened with one row looking pointed at. The light is
  // not drawn until a key is pressed or the pointer reaches a row, which cmdk
  // lights as it passes; a pointer crossing the provider rail would otherwise
  // light the first row while another is chosen. Holding cmdk's value empty
  // does not do it: cmdk keeps its own pick of the first item and shows it at
  // the next update.
  const [engaged, setEngaged] = useState(false);
  const engage = () => {
    setEngaged(true);
  };
  const engageOnRow = (event: PointerEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest("[cmdk-item]")
    ) {
      setEngaged(true);
    }
  };

  const opened = rail.find((entry) => entry.id === openId);
  const searching = query.trim().length > 0;
  const rows: PickerRow[] = searching
    ? rowsForSearch({ models, query })
    : opened && !opened.failed
      ? rowsForConnection({ connectionId: opened.id, models, showAll })
      : [];
  // A newer release of the chosen model is offered on the chosen row itself,
  // beside what replaced it, rather than in a banner of its own.
  const offer =
    notice?.tone === "offer" && notice.action?.kind === "switch"
      ? notice.action
      : undefined;
  const autoRow = !searching && rows[0]?.type === "auto" ? rows[0] : undefined;

  return (
    <Command
      className="flex min-h-0 flex-1 flex-col [&:not([data-engaged])_[data-selected=true]:not([data-chosen]):not([data-solid])]:bg-transparent"
      data-engaged={engaged || undefined}
      label="Search models"
      onKeyDownCapture={engage}
      onPointerMoveCapture={engageOnRow}
      shouldFilter={false}
    >
      <div className="shrink-0 border-b p-2">
        <CommandInput
          autoFocus
          className="h-8 py-0"
          containerClassName="h-8 rounded-lg bg-black/[0.04] px-2.5 dark:bg-white/[0.06]"
          onValueChange={setQuery}
          placeholder="Search models"
          value={query}
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Providers"
          className="flex w-50 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-muted/40 p-2"
        >
          {rail.map((entry) => (
            <button
              aria-current={
                !searching && entry.id === openId ? "true" : undefined
              }
              className={cn(
                "flex min-h-8 items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
                !searching &&
                  entry.id === openId &&
                  "bg-black/[0.06] font-medium dark:bg-white/10",
              )}
              key={entry.id}
              onClick={() => {
                setOpenId(entry.id);
                setQuery("");
                setShowAll(false);
              }}
              type="button"
            >
              <AIProviderIcon
                className="size-4 shrink-0"
                colored
                type={entry.provider}
              />
              <span className="min-w-0 flex-1 truncate">
                {entry.name}
                {/* Named for what pressing it shows, so the accessibility
                    tree says where the rest of the models are while the
                    list holds one connection's. */}
                <span className="sr-only"> models</span>
              </span>
              {entry.failed ? (
                <WarningCircleIcon className="size-4 shrink-0 text-yellow-700 dark:text-yellow-300" />
              ) : (
                entry.id === chosenConnection && (
                  // Where the chosen model lives, so browsing another
                  // connection does not lose it.
                  <>
                    <CheckIcon
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="sr-only">(has the chosen model)</span>
                  </>
                )
              )}
            </button>
          ))}
          <span className="flex-1" />
          <button
            className="flex min-h-8 items-center gap-2.5 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
            onClick={onAddProvider}
            type="button"
          >
            <PlusIcon className="size-4 shrink-0" />
            Add a provider
          </button>
        </nav>
        <div
          className="relative min-h-0 min-w-0 flex-1 overflow-y-auto"
          data-slot="model-picker-scroll"
          ref={scrollRef}
        >
          <CommandList className="max-h-none! overflow-visible! p-2">
            {opened?.failed && !searching ? (
              <FailedConnection
                error={opened.failed}
                isOurs={opened.isOurs}
                onRetry={() => {
                  onAction({ kind: "retry", label: "Retry" });
                }}
              />
            ) : isError ? (
              <EmptyMessage text="Couldn't load models">
                <Button
                  onClick={() => {
                    onAction({ kind: "retry", label: "Retry" });
                  }}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </EmptyMessage>
            ) : rail.length === 0 ? (
              <EmptyMessage text={`Connect a provider to use ${APP_NAME}`}>
                <AddProviderButton onClick={onAddProvider} />
              </EmptyMessage>
            ) : rows.length === 0 ? (
              <EmptyMessage
                text={
                  searching
                    ? "No matching models"
                    : "This provider lists no models"
                }
              >
                <AddProviderButton onClick={onAddProvider} />
              </EmptyMessage>
            ) : (
              <>
                {/* Auto leads its connection's list, set apart from the
                    models under it rather than being the first of them. */}
                {autoRow && rows.length === 1 ? (
                  <AutoOnly
                    chosen={selectedModel?.uri === autoRow.model.uri}
                    model={autoRow.model}
                    onPick={onPick}
                  />
                ) : autoRow ? (
                  <AutoRow
                    chosen={selectedModel?.uri === autoRow.model.uri}
                    model={autoRow.model}
                    onPick={onPick}
                  />
                ) : null}
                {autoRow && rows.length > 1 && (
                  <div className="mx-2.5 my-2 h-px bg-border" />
                )}
                <VirtualRows
                  offer={offer}
                  onAction={onAction}
                  onPick={onPick}
                  onShowAll={setShowAll}
                  rows={autoRow ? rows.slice(1) : rows}
                  scrollRef={scrollRef}
                  selectedModel={selectedModel}
                />
              </>
            )}
          </CommandList>
        </div>
      </div>
    </Command>
  );
}

function VirtualRows({
  offer,
  onAction,
  onPick,
  onShowAll,
  rows,
  scrollRef,
  selectedModel,
}: {
  offer?: ModelAction;
  onAction: (action: ModelAction) => void;
  onPick: (model: AIGatewayModel.Type) => void;
  onShowAll: (showAll: boolean) => void;
  rows: PickerRow[];
  /** The list's scroll, which also holds the notice and Auto above the rows. */
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedModel?: AIGatewayModel.Type;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Where the rows start within the scroll, read after every render: what
  // moves them is the notice or Auto above them coming and going, and
  // each of those is already a render of this component. The equality guard
  // keeps a position that has not moved from writing anything.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) {
      setScrollMargin((current) =>
        current === list.offsetTop ? current : list.offsetTop,
      );
    }
  });

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    estimateSize: (index) => {
      const row = rows[index];
      return row?.type === "header"
        ? 28
        : row?.type === "model" && row.sub
          ? 48
          : 36;
    },
    getScrollElement: () => scrollRef.current,
    // `offsetHeight`, not `getBoundingClientRect()`: the picker sits inside CSS
    // `zoom`, where the rect is the on-screen height while the row offsets and
    // spacer height this feeds are layout px.
    measureElement: (element) => element.offsetHeight,
    // Same unit, for the scrollport this reads its visible range from.
    observeElementRect: (instance, callback) => {
      const element = instance.scrollElement;
      if (!element) {
        return;
      }
      const measure = () => {
        callback({ height: element.offsetHeight, width: element.offsetWidth });
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    },
    overscan: 8,
    scrollMargin,
  });

  // Opens with the chosen model in view, wherever it falls in a long list:
  // the picker's first answer is what is chosen, and the highlight that
  // starts on it is no use below the fold. Once per opening, so it never
  // fights a scroll the user started.
  const chosenIndex = rows.findIndex(
    (row) =>
      (row.type === "auto" || row.type === "model") &&
      row.model.uri === selectedModel?.uri,
  );
  const scrolledToChosen = useRef(false);
  // Every render until it lands: the panel measures itself after its first
  // paint, and a scroll asked of a box with no height yet goes nowhere.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (
      scrolledToChosen.current ||
      chosenIndex <= 0 ||
      !scroll ||
      scroll.clientHeight === 0
    ) {
      return;
    }
    scrolledToChosen.current = true;
    virtualizer.scrollToIndex(chosenIndex, { align: "center" });
  });

  return (
    <div
      className="relative w-full"
      data-slot="model-list"
      ref={listRef}
      style={{ height: `${String(virtualizer.getTotalSize())}px` }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        if (!row) {
          return null;
        }
        return (
          <div
            className="absolute top-0 right-0 left-0"
            data-index={item.index}
            key={item.key}
            ref={virtualizer.measureElement}
            style={{
              transform: `translateY(${String(item.start - scrollMargin)}px)`,
            }}
          >
            {row.type === "header" ? (
              <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">
                {row.provider && (
                  <AIProviderIcon className="size-3.5" type={row.provider} />
                )}
                {row.label}
              </div>
            ) : row.type === "auto" ? (
              <AutoRow
                chosen={selectedModel?.uri === row.model.uri}
                model={row.model}
                onPick={onPick}
              />
            ) : row.type === "show-all" || row.type === "show-fewer" ? (
              <CommandItem
                className="flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground"
                onSelect={() => {
                  onShowAll(row.type === "show-all");
                }}
                value={row.type}
              >
                {row.type === "show-all" ? (
                  <CaretDownIcon className="size-4 shrink-0" />
                ) : (
                  <CaretUpIcon className="size-4 shrink-0" />
                )}
                {row.type === "show-all" ? "Show all models" : "Show fewer"}
              </CommandItem>
            ) : (
              <ModelRow
                chosen={selectedModel?.uri === row.model.uri}
                offer={selectedModel?.uri === row.model.uri ? offer : undefined}
                onAction={onAction}
                onPick={onPick}
                row={row}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Auto, the way Instrument is meant to be used: one line like every model
 * row, so it reads as one of the options, set apart by the recommendation in
 * the brand color after its name and the rule under it.
 */
function AutoRow({
  chosen,
  model,
  onPick,
}: {
  chosen: boolean;
  model: AIGatewayModel.Type;
  onPick: (model: AIGatewayModel.Type) => void;
}) {
  return (
    <CommandItem
      data-chosen={chosen || undefined}
      className={cn(
        "flex min-h-9 items-center gap-2.5 rounded-md px-2.5",
        chosen && CHOSEN,
      )}
      onSelect={() => {
        onPick(model);
      }}
      value={model.uri}
    >
      <AIProviderIcon
        className="size-4 shrink-0"
        colored
        type={OUR_MODELS.providerType}
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className={cn("shrink-0 text-sm", chosen && "font-medium")}>
          Auto
        </span>
        <span className="shrink-0 text-xs font-medium text-brand-700 dark:text-brand-300">
          Recommended
        </span>
        <span
          className={cn(
            "truncate text-xs",
            chosen ? "opacity-80" : "text-muted-foreground",
          )}
        >
          Included with your subscription
        </span>
      </span>
      {chosen && (
        <>
          <CheckIcon aria-hidden className="size-4 shrink-0 text-foreground" />
          <span className="sr-only">(chosen)</span>
        </>
      )}
    </CommandItem>
  );
}

/**
 * Auto when it is all a connection offers, as Instrument does at launch: a
 * single row alone in the pane read as a list with nothing in it, so the
 * one option is drawn as the answer, centered, with the one thing to do
 * about it. Still an item of the list, so the keyboard reaches it.
 */
function AutoOnly({
  chosen,
  model,
  onPick,
}: {
  chosen: boolean;
  model: AIGatewayModel.Type;
  onPick: (model: AIGatewayModel.Type) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-16 pb-10 text-center">
      <AIProviderIcon
        className="size-9"
        colored
        type={OUR_MODELS.providerType}
      />
      <div className="flex flex-col items-center gap-1">
        <span className="flex items-center gap-2 text-base font-medium">
          Auto
          <span className="text-xs font-medium text-brand-700 dark:text-brand-300">
            Recommended
          </span>
        </span>
        <span className="text-sm text-muted-foreground">
          Included with your subscription
        </span>
      </div>
      <CommandItem
        data-solid
        data-chosen={chosen || undefined}
        aria-label={chosen ? "Auto (chosen)" : "Use Auto"}
        className={cn(
          "mt-1 flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
          chosen
            ? "text-foreground"
            : "bg-brand-600 text-white data-[selected=true]:bg-brand-700 data-[selected=true]:text-white dark:bg-brand-500 dark:data-[selected=true]:bg-brand-600",
        )}
        onSelect={() => {
          onPick(model);
        }}
        value={model.uri}
      >
        {chosen ? (
          <>
            <CheckIcon aria-hidden className="size-4" />
            In use
          </>
        ) : (
          "Use Auto"
        )}
      </CommandItem>
    </div>
  );
}

function ModelRow({
  chosen,
  offer,
  onAction,
  onPick,
  row,
}: {
  chosen: boolean;
  /** On the chosen row, the newer release to switch to, beside what replaced it. */
  offer?: ModelAction;
  onAction: (action: ModelAction) => void;
  onPick: (model: AIGatewayModel.Type) => void;
  row: Extract<PickerRow, { type: "model" }>;
}) {
  const { model } = row;
  return (
    <CommandItem
      data-chosen={chosen || undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5",
        row.sub ? "py-1.5" : "min-h-9",
        chosen && CHOSEN,
      )}
      disabled={Boolean(model.restricted)}
      onSelect={() => {
        onPick(model);
      }}
      value={model.uri}
    >
      <ModelMakerIcon author={model.author} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate text-sm", chosen && "font-medium")}>
          <FuzzyHighlight
            ranges={row.nameRanges ?? null}
            text={model.name.trim()}
          />
        </span>
        {row.sub && (
          <span className="flex min-w-0 items-center gap-2 text-xs">
            <span
              className={cn(
                "truncate",
                chosen ? "opacity-80" : "text-muted-foreground",
              )}
            >
              {row.sub}
            </span>
            {offer && (
              <button
                className="shrink-0 font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                onClick={(event) => {
                  // The row picks the model it names; this picks its successor.
                  event.stopPropagation();
                  onAction(offer);
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                type="button"
              >
                {offer.label}
              </button>
            )}
          </span>
        )}
      </span>
      {chosen && (
        <>
          <CheckIcon aria-hidden className="size-4 shrink-0 text-foreground" />
          <span className="sr-only">(chosen)</span>
        </>
      )}
    </CommandItem>
  );
}

function FailedConnection({
  error,
  isOurs,
  onRetry,
}: {
  error: ListError;
  isOurs: boolean;
  onRetry: () => void;
}) {
  return (
    <EmptyMessage
      detail={error.message}
      text={`Couldn't load models from ${error.config.displayName ?? "this provider"}`}
    >
      <div className="flex gap-2">
        <Button onClick={onRetry} size="sm" variant="outline">
          Retry
        </Button>
        <Button
          onClick={() => {
            if (isOurs) {
              openSettings({ tab: "General" });
            } else {
              openSettings({ showNewProviderDialog: false, tab: "Providers" });
            }
          }}
          size="sm"
          variant="outline"
        >
          {isOurs ? "Check account" : "Edit providers"}
        </Button>
      </div>
    </EmptyMessage>
  );
}

function EmptyMessage({
  children,
  detail,
  text,
}: {
  children?: React.ReactNode;
  detail?: string;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {detail && (
        <p className="line-clamp-3 max-w-80 text-xs text-muted-foreground">
          {detail}
        </p>
      )}
      {children}
    </div>
  );
}

function AddProviderButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} size="sm" variant="outline">
      <PlusIcon className="mr-2 size-4" />
      Add a provider
    </Button>
  );
}
