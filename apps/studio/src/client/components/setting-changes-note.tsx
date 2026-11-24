import { rpcClient } from "@/client/rpc/client";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/SlidersHorizontal";
import { useQuery } from "@tanstack/react-query";
import { useContext, useState } from "react";

import {
  ChangeCard,
  ChangeRow,
  RowGlyph,
  SHOWN_ROWS,
  useChangeCardUndo,
} from "./change-card";
import { type ChangesCard } from "./project-changes-card";
import { settingsHrefOf } from "./settings/settings-href";
import { WindowContext } from "./window/context";

/**
 * The settings a turn changed, as a card under the reply: each setting with
 * its value before and after, opening its row in Settings. Undo puts back
 * whatever still stands as the turn left it.
 */
export function SettingChangesNote({
  card,
  changes,
  undone: undoneBefore = false,
}: {
  /** Where the card is, for its Undo to mark it undone on every device. */
  card?: ChangesCard;
  changes: SessionMessageDataPart.SettingChange[];
  /** Undone already, by this device or another. */
  undone?: boolean;
}) {
  const appWindow = useContext(WindowContext);
  const [expanded, setExpanded] = useState(false);
  // Read again when a preference changes, and once for each card.
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const { data: values } = useQuery(
    rpcClient.workspace.settings.values.queryOptions({
      queryKey: ["setting-values", preferences, changes],
    }),
  );
  const { undo, undone, undoing } = useChangeCardUndo({
    call: () =>
      rpcClient.workspace.settings.undoChanges.call({
        ...(card && { card }),
        changes,
      }),
    said: {
      all: "Your settings are back the way they were.",
      some: "Your settings are back the way they were, except the ones you changed since.",
    },
    undoneBefore,
  });
  // Zoom is not among the preferences, so what stands may be stale for it;
  // the undo itself checks again.
  const standing =
    values === undefined ||
    changes.some((change) => values[change.id] === change.after.value);
  const shown = expanded ? changes : changes.slice(0, SHOWN_ROWS);

  return (
    <ChangeCard
      heading={
        changes.length === 1
          ? "Changed a setting"
          : `Changed ${changes.length.toString()} settings`
      }
      hidden={changes.length - shown.length}
      icon={GearSixIcon}
      onShowMore={() => {
        setExpanded(true);
      }}
      slot="setting-changes"
      {...(standing && {
        undo: {
          busy: undoing,
          onUndo: () => {
            void undo();
          },
        },
      })}
      undone={undone}
    >
      {shown.map((change) => {
        const { link } = change;
        return (
          <ChangeRow
            key={change.id}
            lead={<RowGlyph icon={SlidersHorizontalIcon} />}
            lines={[
              {
                key: "value",
                words: `${change.before.label} → ${change.after.label}`,
              },
            ]}
            name={change.title}
            {...(appWindow &&
              link !== undefined && {
                onOpen: () => {
                  appWindow.openScreen(
                    settingsHrefOf({ setting: link.split("/").at(-1) ?? "" }),
                  );
                },
              })}
            quiet={undone}
            struck={undone}
          />
        );
      })}
    </ChangeCard>
  );
}
