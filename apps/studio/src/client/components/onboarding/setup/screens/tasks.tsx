import {
  SetupHead,
  SetupPage,
  SetupPill,
} from "@/client/components/onboarding/setup/chrome";
import { useSetup } from "@/client/components/onboarding/setup/context";
import { type SetupAnswers } from "@/client/components/onboarding/setup/flow";
import {
  type OfferedTask,
  starterTasks,
  workPhrase,
} from "@/client/components/onboarding/setup/tasks-starters";
import { useTaskWriting } from "@/client/components/onboarding/setup/tasks-writing";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { type Icon } from "@phosphor-icons/react";
import { AirplaneIcon } from "@phosphor-icons/react/Airplane";
import { CalendarBlankIcon } from "@phosphor-icons/react/CalendarBlank";
import { ChartBarIcon } from "@phosphor-icons/react/ChartBar";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CoinsIcon } from "@phosphor-icons/react/Coins";
import { EnvelopeIcon } from "@phosphor-icons/react/Envelope";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap";
import { HourglassMediumIcon } from "@phosphor-icons/react/HourglassMedium";
import { HouseIcon } from "@phosphor-icons/react/House";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { MegaphoneIcon } from "@phosphor-icons/react/Megaphone";
import { PaletteIcon } from "@phosphor-icons/react/Palette";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { UsersIcon } from "@phosphor-icons/react/Users";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import ms from "ms";
import { useEffect, useState } from "react";

/** How long the rows load before starter tasks are offered. */
const OFFER_STARTERS_AFTER = ms("5 seconds");
/** How long the rows load before the page says it is slow and asks. */
const SLOW_AFTER = ms("10 seconds");

/** Each task glyph, in its well's hue. */
const TASK_ICONS: Record<string, { icon: Icon; well: string }> = {
  airplane: { icon: AirplaneIcon, well: "bg-sky-500/13 text-sky-700" },
  calendar: { icon: CalendarBlankIcon, well: "bg-pink-500/13 text-pink-700" },
  chart: { icon: ChartBarIcon, well: "bg-green-500/13 text-green-700" },
  code: { icon: CodeIcon, well: "bg-slate-500/13 text-slate-700" },
  envelope: { icon: EnvelopeIcon, well: "bg-blue-500/13 text-blue-700" },
  file: { icon: FileTextIcon, well: "bg-stone-500/13 text-stone-700" },
  graduation: {
    icon: GraduationCapIcon,
    well: "bg-indigo-500/13 text-indigo-700",
  },
  house: { icon: HouseIcon, well: "bg-amber-500/13 text-amber-700" },
  list: { icon: ListChecksIcon, well: "bg-teal-500/13 text-teal-700" },
  magnifier: {
    icon: MagnifyingGlassIcon,
    well: "bg-cyan-500/13 text-cyan-700",
  },
  megaphone: { icon: MegaphoneIcon, well: "bg-rose-500/13 text-rose-700" },
  money: { icon: CoinsIcon, well: "bg-emerald-500/13 text-emerald-700" },
  palette: { icon: PaletteIcon, well: "bg-violet-500/13 text-violet-700" },
  pencil: { icon: PencilSimpleIcon, well: "bg-purple-500/13 text-purple-700" },
  tag: { icon: TagIcon, well: "bg-orange-500/13 text-orange-700" },
  users: { icon: UsersIcon, well: "bg-fuchsia-500/13 text-fuchsia-700" },
};

function offered(tasks: OfferedTask[]): SetupAnswers["tasks"] {
  return tasks.map(({ detail, icon, needsFile, prompt }) => ({
    checked: !needsFile,
    task: { detail, icon, prompt },
  }));
}

/**
 * F13 to F15: the tasks setup offers to save as drafts. The rows load while
 * the tasks written for the person are on their way, and starter tasks are
 * offered after five seconds. Writing is the one place setup spends AI, so
 * it never holds the person: a failure says so and offers another try,
 * starter tasks, or skipping the step, and so does a wait past ten seconds,
 * with keep waiting in place of another try. Skip is there the whole time.
 * When writing was never going to happen (out of usage, or a key kept out
 * of setup) the starter tasks are simply there. Tasks already offered
 * (coming back to the page) stay as they were, checks and all.
 */
export function TasksPage() {
  const { dispatch, state } = useSetup();
  const { tasks, work } = state.answers;
  const writing = useTaskWriting(state);
  const starters = starterTasks(work);
  const [waited, setWaited] = useState(0);
  // Bumped by Keep waiting and Try again, so the wait is timed afresh.
  const [attempt, setAttempt] = useState(0);
  const [choseStarters, setChoseStarters] = useState(false);
  const isOffered = tasks.length > 0;
  const isWriting = writing.status === "writing";

  useEffect(() => {
    if (isOffered || !isWriting) {
      return;
    }
    const offer = setTimeout(() => {
      setWaited(OFFER_STARTERS_AFTER);
    }, OFFER_STARTERS_AFTER);
    const slow = setTimeout(() => {
      setWaited(SLOW_AFTER);
    }, SLOW_AFTER);
    return () => {
      clearTimeout(offer);
      clearTimeout(slow);
    };
  }, [attempt, isOffered, isWriting]);

  // What the page lands on, once: the written tasks when they are back, the
  // starters when the person chose them or writing was never going to run.
  const landing = isOffered
    ? undefined
    : writing.data && !choseStarters
      ? writing.data.tasks
      : writing.status === "off" || choseStarters
        ? starters
        : undefined;
  const trouble = isOffered
    ? undefined
    : writing.status === "failed"
      ? "failed"
      : isWriting && waited >= SLOW_AFTER
        ? "slow"
        : undefined;
  const useStarters = () => {
    setChoseStarters(true);
  };
  useEffect(() => {
    if (landing) {
      dispatch({ answers: { tasks: offered(landing) }, type: "answer" });
    }
  }, [dispatch, landing]);

  const isStarters =
    isOffered && starters.some((task) => task.prompt === tasks[0]?.task.prompt);
  const phrase = workPhrase(work);

  return (
    <SetupPage
      next={{
        disabled: !isOffered,
        label: "Continue",
        onClick: () => {
          dispatch({ step: "all-set", type: "go" });
        },
      }}
      skip={
        isOffered
          ? undefined
          : {
              onClick: () => {
                dispatch({ answers: { tasks: [] }, type: "answer" });
                dispatch({ step: "all-set", type: "go" });
              },
            }
      }
    >
      <SetupHead
        subtitle="We'll save the ones you check as prompts in your Instrument drafts. You decide when to start them."
        title="We picked a few tasks that might be useful"
      />
      <div className="mt-8 w-180">
        <div className="mb-2 flex h-5 items-center gap-2 px-1 text-xs font-medium text-foreground/50">
          {trouble ? null : !isOffered ? (
            <>
              <Spinner className="size-3.5 text-brand-600" delay={0} />
              <span className="flex-1">
                Writing tasks for {phrase ?? "your week"}…
              </span>
              {waited >= OFFER_STARTERS_AFTER && (
                <button
                  className="underline underline-offset-2 hover:text-foreground/80"
                  onClick={useStarters}
                  type="button"
                >
                  Use starter tasks
                </button>
              )}
            </>
          ) : isStarters ? (
            <>
              <ListChecksIcon className="size-3.5" />
              {phrase ? `Starter tasks for ${phrase}` : "Starter tasks to try"}
            </>
          ) : (
            <>
              <SparkleIcon className="size-3.5 text-brand-600" weight="fill" />
              {writing.data?.summary
                ? `Written for ${writing.data.summary}`
                : "Written for you"}
            </>
          )}
        </div>
        {trouble ? (
          <WritingTrouble
            kind={trouble}
            onAgain={() => {
              if (trouble === "failed") {
                writing.retry();
              }
              setWaited(0);
              setAttempt((count) => count + 1);
            }}
            onStarters={useStarters}
          />
        ) : (
          <div className="divide-y divide-foreground/[0.07] overflow-hidden rounded-2xl bg-card shadow-xs ring-1 ring-black/[0.07] dark:ring-white/10">
            {isOffered
              ? tasks.map((entry, index) => (
                  <TaskRow
                    checked={entry.checked}
                    detail={entry.task.detail}
                    icon={entry.task.icon}
                    key={entry.task.prompt}
                    onToggle={() => {
                      dispatch({
                        answers: {
                          tasks: tasks.map((other, at) =>
                            at === index
                              ? { ...other, checked: !other.checked }
                              : other,
                          ),
                        },
                        type: "answer",
                      });
                    }}
                    prompt={entry.task.prompt}
                  />
                ))
              : Array.from({ length: 4 }, (_, index) => (
                  <LoadingRow key={index} />
                ))}
          </div>
        )}
      </div>
    </SetupPage>
  );
}

function TaskRow({
  checked,
  detail,
  icon,
  onToggle,
  prompt,
}: {
  checked: boolean;
  detail: string;
  icon: string;
  onToggle: () => void;
  prompt: string;
}) {
  const glyph = TASK_ICONS[icon] ?? TASK_ICONS.list;
  const Glyph = glyph?.icon ?? ListChecksIcon;
  return (
    <button
      aria-pressed={checked}
      className="flex w-full items-center gap-3.5 px-4 py-3 text-left hover:bg-foreground/[0.02]"
      onClick={onToggle}
      type="button"
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md",
          checked
            ? "bg-brand-600 text-white"
            : "ring-1 ring-foreground/25 ring-inset",
        )}
      >
        {checked && <CheckIcon className="size-3.5" weight="bold" />}
      </span>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg dark:brightness-150",
          glyph?.well,
        )}
      >
        <Glyph className="size-4.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm text-foreground">{prompt}</span>
        <span className="text-xs text-foreground/50">{detail}</span>
      </span>
    </button>
  );
}

/**
 * Writing failed, or is taking too long: said plainly, with another try (or
 * more waiting), starter tasks, and Skip in the footer, so AI never holds
 * the person on this page.
 */
function WritingTrouble({
  kind,
  onAgain,
  onStarters,
}: {
  kind: "failed" | "slow";
  onAgain: () => void;
  onStarters: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-card px-8 py-10 text-center shadow-xs ring-1 ring-black/[0.07] dark:ring-white/10">
      <span className="flex size-10 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground/55">
        {kind === "failed" ? (
          <WarningCircleIcon className="size-5" />
        ) : (
          <HourglassMediumIcon className="size-5" />
        )}
      </span>
      <div className="flex max-w-110 flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          {kind === "failed"
            ? "We couldn't write tasks for you this time"
            : "Writing your tasks is taking longer than usual"}
        </p>
        <p className="text-[13px] text-foreground/55">
          You can try again, start from a few tasks we wrote ahead of time, or
          skip this step and add tasks later.
        </p>
      </div>
      <div className="flex gap-2">
        <SetupPill kind="light" onClick={onAgain} size="small">
          {kind === "failed" ? "Try again" : "Keep waiting"}
        </SetupPill>
        <SetupPill kind="light" onClick={onStarters} size="small">
          Use starter tasks
        </SetupPill>
      </div>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <Skeleton className="size-5 rounded-md" />
      <Skeleton className="size-9 rounded-lg" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-2.5 w-2/5" />
      </div>
    </div>
  );
}

/** F16: one line and one button into the app. */
export function AllSetPage() {
  const { finish, state } = useSetup();
  const { firstName } = state.answers;
  return (
    <SetupPage back={false}>
      <SetupHead
        title={firstName ? `You're all set, ${firstName}` : "You're all set"}
      />
      <SetupPill className="mt-8" onClick={finish} size="large">
        Open Instrument
      </SetupPill>
    </SetupPage>
  );
}
