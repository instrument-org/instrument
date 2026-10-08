import { chatFiltersAtom, type Draft, draftsAtom } from "@/client/atoms/window";
import { SetupPill } from "@/client/components/onboarding/setup/chrome";
import { type SetupAnswers } from "@/client/components/onboarding/setup/flow";
import { setupDraftWords } from "@/client/components/onboarding/setup/tasks-drafts";
import { webPrompt } from "@/client/components/settings/memory-section";
import { NO_FILTERS } from "@/client/components/window/chats";
import { keptAtom } from "@/client/lib/kept-state";
import { FileDashedIcon } from "@phosphor-icons/react/FileDashed";
import { useAtom, useSetAtom } from "jotai";
import { ulid } from "ulid";

/** Whether setup saved drafts the person has not been shown yet. */
const draftsReadyAtom = keptAtom<boolean>(
  "layout",
  "setup.draftsReady.v1",
  false,
);

/**
 * Saves what setup gathered as drafts, the way the app keeps a draft put
 * away: one per checked task and one per memory import left on. When any
 * were saved, the column is put on Drafts, where they show, and the panel
 * pointing at them is due.
 */
export function useSaveSetupDrafts() {
  const setDrafts = useSetAtom(draftsAtom);
  const setFilters = useSetAtom(chatFiltersAtom);
  const setDraftsReady = useSetAtom(draftsReadyAtom);
  return (answers: SetupAnswers) => {
    const words = setupDraftWords(answers, webPrompt);
    if (words.length === 0) {
      return;
    }
    const now = Date.now();
    const saved = words.map(
      (entry): Draft => ({
        createdAt: now,
        id: ulid(),
        updatedAt: now,
        words: entry,
      }),
    );
    setDrafts((current) => [...current, ...saved]);
    setFilters({ ...NO_FILTERS, place: "drafts" });
    setDraftsReady(true);
  };
}

/**
 * F17's panel: once, on the first look at the app after setup saved drafts,
 * a card beside the inbox column saying the drafts are there. Not a sheet,
 * nothing dims, and Got it puts it away for good.
 */
export function DraftsReadyPanel() {
  const [isReady, setIsReady] = useAtom(draftsReadyAtom);
  if (!isReady) {
    return null;
  }
  return (
    <div
      className="absolute top-26 left-105 z-40 w-85 rounded-2xl bg-card p-4 shadow-lg ring-1 ring-black/[0.07] dark:ring-white/10"
      role="dialog"
      aria-label="Your drafts are ready"
    >
      <span
        aria-hidden
        className="absolute top-6 -left-1.5 size-3 -translate-y-1/2 rotate-45 bg-card shadow-[-1px_1px_0_0_rgba(0,0,0,0.07)]"
      />
      <div className="flex gap-3">
        <span className="flex size-8.5 shrink-0 items-center justify-center rounded-lg bg-brand-500/13 text-brand-700 dark:text-brand-300">
          <FileDashedIcon className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">
            Your drafts are ready
          </p>
          <p className="text-[13px] leading-relaxed text-foreground/65">
            The prompts you picked during setup are saved here as drafts. Open
            one, change anything you like, and send it when you're ready.
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <SetupPill
          kind="light"
          onClick={() => {
            setIsReady(false);
          }}
          size="small"
        >
          Got it
        </SetupPill>
      </div>
    </div>
  );
}
