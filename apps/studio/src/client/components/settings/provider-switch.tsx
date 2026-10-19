import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { rpcClient } from "@/client/rpc/client";
import { type AIProviderConfigId, APP_NAME } from "@instrument-org/shared";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

/** What a card says in place of its description while its provider is off. */
export const DISABLED_LINE = `Disabled, so ${APP_NAME} won’t use it until you enable it again.`;

/**
 * Which providers are disabled, and the switch. Disabling one is kept
 * behind each card's more menu, since few people need it; enabling it again
 * is a button on the grayed card.
 */
export function useProviderSwitch() {
  const { data: disabled } = useQuery(
    rpcClient.providerConfig.live.disabled.experimental_liveOptions(),
  );
  const setEnabled = useMutation(
    rpcClient.providerConfig.setEnabled.mutationOptions(),
  );
  return {
    isOff: (id: string) => disabled?.some((entry) => entry === id) ?? false,
    setEnabled: (id: AIProviderConfigId, enabled: boolean) => {
      setEnabled.mutate({ enabled, id });
    },
  };
}

/** The "⋯" button at a card's right, opening `children` as its items. */
export function ProviderMoreMenu({
  children,
  label,
  size = "icon",
}: {
  children: ReactNode;
  label: string;
  /** `icon-sm` beside small buttons, as on an account's own line. */
  size?: "icon" | "icon-sm";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant="ghost">
          <DotsThreeIcon className="size-5" />
          <span className="sr-only">{`More for ${label}`}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DisableItem({ onSelect }: { onSelect: () => void }) {
  return <DropdownMenuItem onSelect={onSelect}>Disable</DropdownMenuItem>;
}
