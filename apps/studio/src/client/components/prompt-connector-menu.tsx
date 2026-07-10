import {
  appendToPromptAtom,
  type PromptDraftKey,
} from "@/client/atoms/prompt-value";
import { openSettings } from "@/client/atoms/settings-modal";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { rpcClient } from "@/client/rpc/client";
import { PlugsConnectedIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";

/**
 * The "+" affordance in the prompt input: mention an enabled connector (inserts
 * an `@slug` token the agent resolves against its connector context) or jump to
 * Settings to add a new one. Standard menu, kept intentionally light -- the
 * agent already knows the workspace's connectors, so a mention is just a nudge.
 */
export function PromptConnectorMenu({
  disabled,
  draftKey,
}: {
  disabled?: boolean;
  draftKey: PromptDraftKey;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  const { data } = useQuery(rpcClient.connectors.list.queryOptions());

  const enabled = (data?.connectors ?? []).filter(
    (connector) => connector.enabled,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Connectors"
          className="size-8 p-0"
          disabled={disabled}
          size="sm"
          variant="ghost"
        >
          <PlusIcon className="size-5" weight="regular" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-64">
        <DropdownMenuLabel>Connectors</DropdownMenuLabel>
        {enabled.length === 0 ? (
          <DropdownMenuItem disabled>No connectors yet</DropdownMenuItem>
        ) : (
          enabled.map((connector) => (
            <DropdownMenuItem
              key={connector.slug}
              onSelect={() => {
                appendToPrompt({
                  key: draftKey,
                  update: `@${connector.slug}`,
                });
              }}
            >
              <PlugsConnectedIcon />
              <span className="truncate">{connector.displayName}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            openSettings({ tab: "Connectors" });
          }}
        >
          <PlusIcon />
          Add a connector…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
