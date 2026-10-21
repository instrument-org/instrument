import {
  hasMakerMark,
  ModelMakerIcon,
} from "@/client/components/model-maker-icon";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import {
  allowanceLabel,
  allowanceMeter,
  describeDate,
  formatAmount,
  isDowngrade,
  planCardAction,
  type PlanCardAction,
  scheduledPlanChange,
} from "@/client/lib/billing";
import { cn } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import { CheckIcon } from "@phosphor-icons/react/Check";

type Offer = RPCOutput["billing"]["offer"];
type OfferPlan = Offer["plans"][number];
type Status = RPCOutput["billing"]["status"];

/**
 * The plan picker: one card per plan the offer lists, however many that is,
 * side by side and wrapping. Each card's button says what it does for this
 * account (Subscribe, Switch to, Start free trial); the plan they are on is
 * marked instead. A cheaper plan starts when the period ends, which its card
 * says before and after it is chosen; while that change waits, the plan they
 * are on offers to keep it. One card leads with the brand button so the
 * choice has an obvious default: the preselected plan, else the first one
 * they could take. The plan with the most AI usage is tinted in the brand's
 * green. Every card names the makers behind Instrument's models and lists
 * the plan's features as the offer gives them.
 * The cards share a row and stack when it is too narrow for them.
 *
 * The same component is setup's plan step and the app's plan sheet.
 */
export function PlanCards({
  busyPlan,
  offer,
  onChoose,
  preselect,
  status,
  trial = false,
}: {
  /** The plan whose button is working (opening Checkout, switching). */
  busyPlan?: null | string;
  offer: Offer;
  onChoose: (plan: OfferPlan, action: PlanCardAction) => void;
  preselect?: string;
  status: Status | undefined;
  /** Setup's trial step: every card starts the trial instead of subscribing. */
  trial?: boolean;
}) {
  const now = new Date();
  const change = scheduledPlanChange(status, offer);
  const periodEnd = status?.subscription?.currentPeriodEnd;
  const changeAt = change?.at ?? (periodEnd ? new Date(periodEnd) : undefined);
  const actions = offer.plans.map((plan) => {
    const action = planCardAction(plan, status, { trial });
    const note =
      changeAt &&
      (action === "scheduled" ||
        (action === "switch" && isDowngrade(plan, status, offer)))
        ? `Starts ${describeDate(changeAt, now)}`
        : action === "keep" && changeAt
          ? `Until ${describeDate(changeAt, now)}`
          : undefined;
    return { action, note, plan };
  });
  const isChoosable = (action: PlanCardAction) =>
    action !== "current" && action !== "scheduled";
  const most = Math.max(...offer.plans.map((plan) => plan.allowance.multiple));
  const least = Math.min(...offer.plans.map((plan) => plan.allowance.multiple));
  const leading =
    actions.find(
      ({ action, plan }) => plan.key === preselect && isChoosable(action),
    ) ?? actions.find(({ action }) => isChoosable(action));

  return (
    <div className="flex flex-wrap gap-3" data-plan-cards>
      {actions.map(({ action, note, plan }) => (
        <PlanCard
          action={action}
          isBusy={busyPlan === plan.key}
          isHeaviest={most > least && plan.allowance.multiple === most}
          isLeading={leading?.plan.key === plan.key}
          key={plan.key}
          makers={planMakers(plan)}
          meter={allowanceMeter(plan, offer.plans)}
          note={note}
          onChoose={() => {
            onChoose(plan, action);
          }}
          plan={plan}
        />
      ))}
    </div>
  );
}

/**
 * Who makes the plan's models, in the order its policy lists them, for the
 * makers this client has a mark for: none when the offer names none.
 */
function planMakers(plan: OfferPlan): string[] {
  const makers = new Set<string>();
  for (const model of plan.models ?? []) {
    const maker = model.maker === "xai" ? "x-ai" : model.maker;
    if (maker !== undefined && hasMakerMark(maker)) {
      makers.add(maker);
    }
  }
  return [...makers];
}

function PlanCard({
  action,
  isBusy,
  isHeaviest,
  isLeading,
  makers,
  meter,
  note,
  onChoose,
  plan,
}: {
  action: PlanCardAction;
  isBusy: boolean;
  /** The plan with the most AI usage, tinted in the brand's green. */
  isHeaviest: boolean;
  isLeading: boolean;
  makers: string[];
  meter: { filled: number; segments: number };
  /** When the plan starts or stops, for a change that waits on the period. */
  note: string | undefined;
  onChoose: () => void;
  plan: OfferPlan;
}) {
  const amount = formatAmount(plan.price);
  const isCurrent = action === "current" || action === "keep";
  const label = {
    current: "",
    keep: `Keep ${plan.name}`,
    scheduled: "",
    subscribe: amount ? `Subscribe for ${amount}` : "Subscribe",
    switch: `Switch to ${plan.name}`,
    trial: "Start free trial",
  }[action];

  return (
    <Card
      className={cn(
        "min-w-60 flex-1 basis-0 gap-3 rounded-3xl border p-5",
        isHeaviest
          ? "border-brand-100 bg-linear-to-b from-brand-50 to-card shadow-md dark:border-brand-800 dark:from-brand-950/50"
          : "border-border",
        isCurrent && "border-brand-500/60",
      )}
      data-heaviest={isHeaviest || undefined}
      data-plan-card={plan.key}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-base font-medium",
            isHeaviest
              ? "text-brand-600 dark:text-brand-300"
              : "text-muted-foreground",
          )}
        >
          {plan.name}
        </span>
        {isCurrent && <Badge variant="outline">Your plan</Badge>}
      </div>
      {amount && (
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-semibold tracking-tight">
            {amount}
          </span>
          {plan.price?.interval && (
            <span className="text-sm text-gray-400 dark:text-gray-500">
              / {plan.price.interval}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-4 rounded-xl bg-black/5 px-3.5 py-2.5 text-sm dark:bg-white/5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">AI usage</span>
            <span className="font-semibold" data-allowance>
              {allowanceLabel(plan)}
            </span>
          </div>
          <div
            aria-hidden
            className="flex gap-1"
            data-allowance-meter={`${meter.filled}/${meter.segments}`}
          >
            {Array.from({ length: meter.segments }, (_, index) => (
              <span
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  index < meter.filled
                    ? "bg-brand-600 dark:bg-brand-500"
                    : "bg-black/5 dark:bg-white/10",
                )}
                key={index}
              />
            ))}
          </div>
        </div>
        {makers.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Models</span>
            <span className="flex items-center gap-2" data-plan-makers>
              {makers.map((maker) => (
                <ModelMakerIcon author={maker} key={maker} />
              ))}
            </span>
          </div>
        )}
      </div>
      {plan.features.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {plan.features.map((feature) => (
            <li className="flex items-center gap-2" key={feature}>
              <CheckIcon className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
              <span className="text-gray-700 dark:text-gray-300">
                {feature}
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {label && (
        <Button
          className="mt-auto w-full"
          disabled={isBusy}
          onClick={onChoose}
          size="lg"
          variant={isLeading ? "brand" : "default"}
        >
          {label}
        </Button>
      )}
    </Card>
  );
}
