import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { formatPlanPrice } from "@/client/lib/billing";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { getDebugRoute } from "./-debug-routes";

export const Route = createFileRoute("/debug/billing")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugRoute("billing").title }],
  }),
});

/**
 * The platform's billing reads as they come back, for checking the billing
 * system end to end against a local API. Deliberately plain: this is a
 * window onto `billing.offer`, `billing.status`, and the last refusal, not
 * the product's billing screen. Limits change through `pnpm billing`, never
 * from here.
 */
function RouteComponent() {
  const queryClient = useQueryClient();
  const environment = useQuery(
    rpcClient.billing.dev.environment.queryOptions(),
  );
  const hasToken = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const status = useQuery(
    rpcClient.billing.status.queryOptions({ enabled: hasToken.data === true }),
  );
  const offer = useQuery(rpcClient.billing.offer.queryOptions());
  const lastRefusal = useQuery(rpcClient.billing.lastRefusal.queryOptions());

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: rpcClient.billing.key(),
    });
  };

  const [token, setToken] = useState("");
  const [burnUsd, setBurnUsd] = useState("0.4");
  const setDevToken = useMutation(
    rpcClient.billing.dev.setDevToken.mutationOptions({ onSuccess: refresh }),
  );
  const burn = useMutation(
    rpcClient.billing.dev.burn.mutationOptions({ onSettled: refresh }),
  );
  const openCheckout = useMutation(
    rpcClient.billing.openCheckout.mutationOptions(),
  );
  const openPortal = useMutation(
    rpcClient.billing.openPortal.mutationOptions(),
  );

  const refusal = lastRefusal.data;

  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 text-sm">
        <Section title="Session">
          <Facts
            rows={[
              ["API", environment.data?.apiBaseUrl],
              ["Signed in", String(hasToken.data ?? false)],
            ]}
          />
          <div className="flex gap-2">
            <Input
              aria-label="Dev session token"
              onChange={(event) => {
                setToken(event.target.value);
              }}
              placeholder="Token from pnpm billing dev-session"
              value={token}
            />
            <Button
              disabled={!token || setDevToken.isPending}
              onClick={() => {
                setDevToken.mutate({ token });
              }}
              size="sm"
            >
              Use token
            </Button>
          </div>
          <ErrorLine error={setDevToken.error} />
        </Section>

        <Section title="billing.status">
          <ErrorLine error={status.error} />
          {status.data && (
            <>
              <Facts
                rows={[
                  ["plan", status.data.plan],
                  ["trial.state", status.data.trial.state],
                  ["trial.percentUsed", status.data.trial.percentUsed],
                  ["trial.endsAt", status.data.trial.endsAt],
                  ["binding", status.data.binding],
                  ["canSubscribe", String(status.data.canSubscribe)],
                  ["subscription.status", status.data.subscription?.status],
                  [
                    "subscription.cancelAtPeriodEnd",
                    status.data.subscription &&
                      String(status.data.subscription.cancelAtPeriodEnd),
                  ],
                  [
                    "subscription.currentPeriodEnd",
                    status.data.subscription?.currentPeriodEnd,
                  ],
                ]}
              />
              <Table
                head={["window", "percentUsed", "resetsAt"]}
                rows={status.data.windows.map((window) => [
                  window.key,
                  `${window.percentUsed}%`,
                  window.resetsAt ?? "-",
                ])}
              />
              <p className="text-xs text-muted-foreground">
                Dollars spent and capped, the policy id and version, and the
                experiment arm are not sent to clients. Read them with{" "}
                <code>pnpm billing user show &lt;email&gt;</code>.
              </p>
            </>
          )}
        </Section>

        <Section title="Last refusal">
          {refusal ? (
            <Facts
              rows={[
                ["code", refusal.code],
                ["status", refusal.status],
                ["retryAfterSeconds", refusal.retryAfterSeconds],
                [
                  "retry at",
                  refusal.retryAfterSeconds &&
                    new Date(
                      refusal.at + refusal.retryAfterSeconds * 1000,
                    ).toISOString(),
                ],
                ["message", refusal.message],
                ["details", JSON.stringify(refusal.details)],
                ["path", refusal.path],
                ["at", new Date(refusal.at).toISOString()],
              ]}
            />
          ) : (
            <p className="text-muted-foreground">None since launch</p>
          )}
        </Section>

        <Section title="Actions">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={refresh} size="sm" variant="outline">
              Refresh
            </Button>
            {offer.data?.plans.map((plan) => (
              <Button
                key={plan.key}
                onClick={() => {
                  openCheckout.mutate({ plan: plan.key });
                }}
                size="sm"
                variant="outline"
              >
                Checkout {plan.key}
              </Button>
            ))}
            <Button
              onClick={() => {
                openPortal.mutate(undefined);
              }}
              size="sm"
              variant="outline"
            >
              Open Customer Portal
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Burn amount in USD"
              className="w-24"
              onChange={(event) => {
                setBurnUsd(event.target.value);
              }}
              value={burnUsd}
            />
            <Button
              disabled={burn.isPending || !(Number(burnUsd) >= 0)}
              onClick={() => {
                burn.mutate({ usd: Number(burnUsd) });
              }}
              size="sm"
              variant="outline"
            >
              Burn ${burnUsd} (local stub)
            </Button>
            {burn.data && (
              <span className="text-muted-foreground">
                last burn: HTTP {burn.data.status}
                {burn.data.refusal && ` ${burn.data.refusal.code}`}
                {burn.data.bodyHasCost && " (response carried a cost field)"}
              </span>
            )}
          </div>
          <ErrorLine
            error={openCheckout.error ?? openPortal.error ?? burn.error}
          />
          {(openCheckout.data ?? openPortal.data) && (
            <p className="text-xs break-all text-muted-foreground">
              Opened {(openCheckout.data ?? openPortal.data)?.url}
            </p>
          )}
        </Section>

        <Section title="billing.offer">
          <ErrorLine error={offer.error} />
          {offer.data && (
            <>
              <Facts
                rows={[
                  ["offerVersion", offer.data.offerVersion],
                  [
                    "trial",
                    offer.data.trial
                      ? `${offer.data.trial.days} days, card ${offer.data.trial.cardRequired ? "required" : "not required"}, available ${String(offer.data.trial.available ?? "-")}`
                      : "none",
                  ],
                ]}
              />
              <Table
                head={["key", "name", "price", "multiple", "windows"]}
                rows={offer.data.plans.map((plan) => [
                  plan.key,
                  plan.name,
                  formatPlanPrice(plan.price) || "-",
                  `${plan.allowance.multiple}x`,
                  plan.allowance.windows.map((window) => window.key).join(" "),
                ])}
              />
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-2" data-billing-section={title}>
      <h2 className="font-mono text-xs font-semibold text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Facts({
  rows,
}: {
  rows: [string, null | number | string | undefined][];
}) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 font-mono text-xs">
      {rows.map(([label, value]) => (
        <div className="contents" key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all" data-billing-field={label}>
            {value ?? "-"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full font-mono text-xs">
      <thead>
        <tr>
          {head.map((cell) => (
            <th
              className="text-left font-normal text-muted-foreground"
              key={cell}
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr data-billing-row={row[0]} key={row[0]}>
            {row.map((cell, index) => (
              <td key={head[index]}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ErrorLine({ error }: { error: Error | null }) {
  return error ? (
    <p className="text-xs text-destructive">{error.message}</p>
  ) : null;
}
