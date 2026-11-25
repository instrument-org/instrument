import { type StoreId } from "@instrument-org/workspace/client";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";

import { SHARED } from "@/client/lib/styles";

/** Under an edited message: which of its versions is up, and the ones either side. */
export function MessageVersions({
  at,
  onShow,
  versions,
}: {
  at: number;
  onShow: (version: StoreId.Message) => void;
  versions: readonly StoreId.Message[];
}) {
  const earlier = versions[at - 1];
  const later = versions[at + 1];
  return (
    <div
      className="flex items-center justify-end gap-0.5 text-xs text-muted-foreground tabular-nums"
      data-slot="message-versions"
    >
      <button
        aria-label="Earlier version"
        className={SHARED.messageFooterButton}
        disabled={earlier === undefined}
        onClick={() => {
          if (earlier !== undefined) {
            onShow(earlier);
          }
        }}
        type="button"
      >
        <CaretLeftIcon size={12} />
      </button>
      <span>
        {at + 1} of {versions.length}
      </span>
      <button
        aria-label="Later version"
        className={SHARED.messageFooterButton}
        disabled={later === undefined}
        onClick={() => {
          if (later !== undefined) {
            onShow(later);
          }
        }}
        type="button"
      >
        <CaretRightIcon size={12} />
      </button>
    </div>
  );
}
