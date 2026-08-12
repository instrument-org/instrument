import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { type ClientAIProviderConfig } from "@/shared/schemas/provider";

import { AddProviderForm } from "./form";

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
      <DialogContent className="transition-none" maxWidth="32rem">
        <DialogTitle className="sr-only">Add provider</DialogTitle>
        <DialogDescription className="sr-only">
          Select a provider to add for AI model usage.
        </DialogDescription>
        {open && (
          <AddProviderForm onSuccess={onSuccess} providers={providers} />
        )}
      </DialogContent>
    </Dialog>
  );
}
