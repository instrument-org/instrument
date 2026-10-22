import { type SetupPageProps } from "../setup-page-props";
import { previewPage } from "./preview";
import { type WaysInPage, WaysIn } from "./ways-in";

/**
 * The way in: Google, a subscription or a key. Done once one is ready; an
 * account with no plan stays here on its answer.
 */
export function WayInStep({ hold, onContinue }: SetupPageProps) {
  return (
    <WaysIn
      hold={hold}
      initial={previewPage<WaysInPage>("way-in") ?? { kind: "ways" }}
      offerInstrument
      onDone={onContinue}
    />
  );
}
