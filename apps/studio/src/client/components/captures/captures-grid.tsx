import { cn, osConventions } from "@/client/lib/utils";
import { buildLabel, type Capture, captureUrl } from "@/shared/captures";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { TrashIcon } from "@phosphor-icons/react/Trash";

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  weekday: "long",
});
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function takenAt(capture: Capture) {
  return capture.meta?.takenAt ?? capture.stamp;
}

/** "Today", "Yesterday", or the day's name and date. */
function dayName(time: number) {
  const day = new Date(time);
  const today = new Date();
  const days = Math.round(
    (new Date(today.toDateString()).getTime() -
      new Date(day.toDateString()).getTime()) /
      86_400_000,
  );
  return days === 0
    ? "Today"
    : days === 1
      ? "Yesterday"
      : dayFormat.format(day);
}

/** The captures, newest first and a heading per day, each with the build that took it. */
export function CapturesGrid({
  captures,
  onPick,
  onTrash,
  selected,
}: {
  captures: readonly Capture[];
  onPick: (capture: Capture) => void;
  /** Moves a capture to the Trash, from a button on its picture. */
  onTrash?: (capture: Capture) => void;
  /** The names picked, for a grid that picks several. */
  selected?: ReadonlySet<string>;
}) {
  const trashWord = osConventions().trash;
  const days: { captures: Capture[]; name: string }[] = [];
  for (const capture of captures) {
    const name = dayName(takenAt(capture));
    const last = days.at(-1);
    if (last?.name === name) {
      last.captures.push(capture);
    } else {
      days.push({ captures: [capture], name });
    }
  }
  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => (
        <div className="flex flex-col gap-2" key={day.name}>
          <div className="text-xs font-medium text-muted-foreground">
            {day.name}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {day.captures.map((capture) => {
              const on = selected?.has(capture.name) === true;
              const tile = (
                <button
                  aria-pressed={selected ? on : undefined}
                  className="group flex min-w-0 flex-col gap-1 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  key={capture.name}
                  onClick={() => {
                    onPick(capture);
                  }}
                  type="button"
                >
                  <span
                    className={cn(
                      "relative block aspect-[16/10] w-full overflow-hidden rounded-md bg-muted ring-1 ring-border",
                      on
                        ? "ring-2 ring-brand-600"
                        : "group-hover:ring-foreground/30",
                    )}
                  >
                    <img
                      alt=""
                      className="size-full object-cover object-top"
                      draggable={false}
                      loading="lazy"
                      src={captureUrl(capture, { small: true })}
                    />
                    {selected && (
                      <span
                        className={cn(
                          "absolute top-1.5 left-1.5 grid size-4 place-items-center rounded-[4px]",
                          on
                            ? "bg-primary text-primary-foreground"
                            : "border border-input bg-card/90",
                        )}
                      >
                        {on && <CheckIcon className="size-3" weight="bold" />}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs">
                    {timeFormat.format(takenAt(capture))}
                  </span>
                  {capture.meta && (
                    <span className="-mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {buildLabel(capture.meta.build)}
                    </span>
                  )}
                </button>
              );
              return onTrash ? (
                <div className="group/tile relative min-w-0" key={capture.name}>
                  {tile}
                  <button
                    aria-label={`Move to ${trashWord}`}
                    className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white opacity-0 group-hover/tile:opacity-100 hover:bg-black/80 focus-visible:opacity-100"
                    onClick={() => {
                      onTrash(capture);
                    }}
                    title={`Move to ${trashWord}`}
                    type="button"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </div>
              ) : (
                tile
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
