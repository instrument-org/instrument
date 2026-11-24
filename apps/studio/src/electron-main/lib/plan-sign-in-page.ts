import { publisher } from "@/electron-main/rpc/publisher";
import { type ConnectProvider } from "@/shared/connect-outcome";
import { shell } from "electron";
import { z } from "zod";

/** Where a plan's sign-in page opens: a tab of the window that asked, or the person's own browser. */
export const PlanSignInOpensInSchema = z
  .enum(["app", "external"])
  .default("external");

export type PlanSignInOpensIn = z.output<typeof PlanSignInOpensInSchema>;

/**
 * Opens a plan's sign-in page. For the app, the window that started the
 * sign-in hears the address and opens it in a tab, since only it knows where.
 * Neither way logs the address, which carries the sign-in's own state.
 */
export async function openPlanSignInPage({
  opensIn,
  provider,
  url,
}: {
  opensIn: PlanSignInOpensIn;
  provider: Exclude<ConnectProvider, "instrument">;
  url: string;
}) {
  if (opensIn === "app") {
    publisher.publish("plan-sign-in.page", { provider, url });
    return;
  }
  await shell.openExternal(url);
}
