import { SetupPill } from "@/client/components/onboarding/setup/chrome";
import {
  isHeavyPlan,
  meterSteps,
} from "@/client/components/onboarding/setup/plans-billing";
import { allowanceLabel, formatAmount } from "@/client/lib/billing";
import { cn } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { type ReactNode } from "react";

type OfferPlan = RPCOutput["billing"]["offer"]["plans"][number];

/** What the standard plan's card lists. */
const STANDARD_ITEMS = [
  "Advanced web search",
  "Works with text, images and files",
  "Image generation",
  "Dictation",
];

/** What the heavy-use plan's card lists: only what it adds. */
const HEAVY_ITEMS: { strong?: boolean; text: string }[] = [
  { text: "Everything in Instrument" },
  { strong: true, text: "4× the AI usage" },
  { text: "Higher limits for busy weeks" },
];

/**
 * One plan, drawn the setup assistant's way: name, price, the AI usage as a
 * four-step meter, what it includes, and its button. The heavy-use plan is
 * tinted and ringed.
 */
export function SetupPlanCard({
  badge,
  busy,
  cta,
  items,
  onChoose,
  plan,
  price,
  tinted,
}: {
  badge?: string;
  busy?: boolean;
  cta: string;
  /** What it includes; the plan's own list by default. */
  items?: { strong?: boolean; text: string }[];
  onChoose: () => void;
  plan: OfferPlan;
  /** In place of the plan's own price, for an offer that changes it. */
  price?: ReactNode;
  tinted?: boolean;
}) {
  const heavy = tinted ?? isHeavyPlan(plan);
  const amount = formatAmount(plan.price);
  const list: { strong?: boolean; text: string }[] =
    items ??
    (isHeavyPlan(plan)
      ? HEAVY_ITEMS
      : STANDARD_ITEMS.map((text) => ({ text })));

  return (
    <div
      className={cn(
        "relative flex w-75 flex-col rounded-[22px] p-5 text-left",
        heavy
          ? "bg-brand-50 shadow-[0_18px_40px_-18px_rgba(11,96,86,0.45)] ring-2 ring-brand-500/50 dark:bg-brand-950/40"
          : "bg-card shadow-[0_10px_30px_-16px_rgba(28,25,23,0.35)] ring-1 ring-black/[0.07] dark:ring-white/10",
      )}
      data-plan-card={plan.key}
    >
      {badge && (
        <span className="absolute -top-3 right-5 rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white">
          {badge}
        </span>
      )}
      <div className="text-[15px] font-semibold text-foreground">
        {plan.name}
      </div>
      {price ??
        (amount && (
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-4xl font-semibold tracking-tight text-foreground">
              {amount}
            </span>
            {plan.price?.interval && (
              <span className="text-sm text-foreground/45">
                / {plan.price.interval}
              </span>
            )}
          </div>
        ))}
      <div
        className={cn(
          "mt-3 rounded-xl px-3.5 py-2.5 text-[13px]",
          heavy ? "bg-card/90" : "bg-foreground/[0.04]",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-foreground/55">AI usage</span>
          <span className="font-semibold text-foreground">
            {allowanceLabel(plan)}
          </span>
        </div>
        <UsageMeter filled={meterSteps(plan)} />
      </div>
      <ul className="mt-3.5 space-y-1.5 text-[13px] text-foreground/75">
        {list.map((item) => (
          <li className="flex items-start gap-2" key={item.text}>
            <CheckIcon className="mt-0.5 size-3.75 shrink-0 text-brand-600" />
            <span
              className={cn(item.strong && "font-semibold text-foreground")}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-4">
        <SetupPill className="w-full" disabled={busy} onClick={onChoose}>
          {cta}
        </SetupPill>
      </div>
    </div>
  );
}

/** AI usage as four steps: the standard plan fills one, four times it all four. */
function UsageMeter({ filled }: { filled: number }) {
  return (
    <div aria-hidden className="mt-2 flex gap-1">
      {[0, 1, 2, 3].map((index) => (
        <span
          className={cn(
            "h-1.5 flex-1 rounded-full",
            index < filled ? "bg-brand-600" : "bg-foreground/10",
          )}
          key={index}
        />
      ))}
    </div>
  );
}

/** The trial's length in a quiet disc, over Trial started. */
export function TrialDaysDisc({ days }: { days: number }) {
  return (
    <div className="grid size-37.5 place-items-center rounded-full bg-brand-100/70 dark:bg-brand-900/40">
      <div className="text-center">
        <div className="font-serif text-5xl leading-none font-medium text-brand-800 dark:text-brand-200">
          {days}
        </div>
        <div className="mt-1 text-xs text-foreground/55">
          {days === 1 ? "day" : "days"}
        </div>
      </div>
    </div>
  );
}
