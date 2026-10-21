import { type SetupPageProps } from "../setup-pages";
import { previewPage } from "./preview";
import { type WaysInPage, WaysIn } from "./ways-in";

/**
 * The way in: Welcome, then Google, a subscription or a key. Done once one
 * is ready; an account with no plan stays here on its answer.
 */
export function WayInStep({ hold, onContinue }: SetupPageProps) {
  return (
    <WaysIn
      hold={hold}
      initial={previewPage<WaysInPage>("way-in") ?? { kind: "welcome" }}
      offerInstrument
      onDone={onContinue}
    />
  );
}
