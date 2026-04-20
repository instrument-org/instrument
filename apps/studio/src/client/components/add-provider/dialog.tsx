import { Dialog, DialogContent } from "@/client/components/ui/dialog";
import { type ClientAIProviderConfig } from "@/shared/schemas/provider";

import { ProviderConfigScreen } from "./provider-config-screen";

const EMPTY_PROVIDERS: ClientAIProviderConfig[] = [];

export function AddProviderDialog({
  onOpenChange,
  onSuccess,
  open,
  providers = EMPTY_PROVIDERS,
}: {
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  open: boolean;
  providers?: ClientAIProviderConfig[];
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="transition-none sm:max-w-lg">
        {open && (
          <ProviderConfigScreen onSuccess={onSuccess} providers={providers} />
        )}
      </DialogContent>
    </Dialog>
  );
}
