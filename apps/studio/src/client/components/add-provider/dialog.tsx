import { type LastConnection } from "@/client/components/setup/last-connection";
import {
  MAIN_MODEL_TITLE,
  MainModelList,
  useMainModelChoice,
} from "@/client/components/setup/steps/model";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { rpcClient } from "@/client/rpc/client";
import { type ClientAIProviderConfig } from "@/shared/schemas/provider";
import { useState } from "react";

import { AddProviderForm } from "./form";

const EMPTY_PROVIDERS: ClientAIProviderConfig[] = [];

/**
 * Settings' Add provider: the key form, then the main model step setup
 * asks, holding to the key just added. Skip, Esc, or a list that never
 * loads all close it with the default left where it was.
 */
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
  const [model, setModel] = useState<{ connection?: LastConnection }>();
  // The keys from before the form, so the one it adds is the new one.
  const [knownKeys] = useState(
    () => new Set(providers.map((config) => config.id)),
  );
  const keyAdded = async () => {
    const list = await rpcClient.providerConfig.list
      .call({})
      .catch(() => undefined);
    const fresh = list?.find((config) => !knownKeys.has(config.id));
    setModel({
      connection: fresh && { kind: "key", providerConfigId: fresh.id },
    });
  };
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="transition-none" maxWidth="32rem">
        <DialogTitle className="sr-only">Add provider</DialogTitle>
        <DialogDescription className="sr-only">
          Select a provider to add for AI model usage.
        </DialogDescription>
        {open &&
          (model ? (
            <ModelStep connection={model.connection} onDone={onSuccess} />
          ) : (
            <AddProviderForm
              onSuccess={() => {
                void keyAdded();
              }}
              providers={providers}
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function ModelStep({
  connection,
  onDone,
}: {
  connection?: LastConnection;
  onDone: () => void;
}) {
  const choice = useMainModelChoice(connection);
  return (
    <div className="flex min-w-0 flex-col">
      <h2 className="font-serif text-xl leading-tight font-medium">
        {MAIN_MODEL_TITLE}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{choice.subtitle}</p>
      <MainModelList choice={choice} className="mt-4" />
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onDone} variant="ghost">
          Skip
        </Button>
        <Button
          disabled={choice.isLoading || choice.isSaving}
          onClick={() => {
            choice.save(onDone);
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
