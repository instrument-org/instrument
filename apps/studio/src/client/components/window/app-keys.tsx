import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Destination } from "@/client/components/window/connect-destination";
import { type AppKey } from "@/client/components/window/key-form";
import { PageSection } from "@/client/components/window/page-section";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

/**
 * The keys a connected app has saved, each with enough to recognize it by
 * (its last four characters and the day it was saved) and a way to replace
 * it. A whole key is never shown.
 */
export function AppKeys({
  keys,
  name,
  origin,
  slug,
}: {
  keys: AppKey[];
  name: string;
  origin: string;
  slug: string;
}) {
  return (
    <PageSection title={keys.length > 1 ? "Keys" : "Key"}>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {keys.map((key) => (
          <SavedKey
            appKey={key}
            key={key.label ?? ""}
            name={name}
            origin={origin}
            slug={slug}
          />
        ))}
      </div>
    </PageSection>
  );
}

function SavedKey({
  appKey,
  name,
  origin,
  slug,
}: {
  appKey: AppKey;
  name: string;
  origin: string;
  slug: string;
}) {
  const [isReplacing, setIsReplacing] = useState(false);
  const [value, setValue] = useState("");
  const replace = useMutation(
    rpcClient.apps.replaceCredential.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't save the key", { cause: error });
      },
      onSuccess: ({ outcome }) => {
        setValue("");
        if (outcome === "replaced") {
          setIsReplacing(false);
        }
      },
    }),
  );
  const label = appKey.label ?? "API key";
  if (!isReplacing) {
    return (
      <div className="flex min-h-12 items-center gap-3 px-4 py-2">
        <span className="w-36 shrink-0 truncate text-sm">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
          <SavedLine appKey={appKey} />
        </span>
        <Button
          className="text-foreground"
          onClick={() => {
            replace.reset();
            setIsReplacing(true);
          }}
          size="sm"
          variant="outline"
        >
          Replace
        </Button>
      </div>
    );
  }
  const canSave = value.trim() !== "" && !replace.isPending;
  const save = () => {
    if (canSave) {
      replace.mutate({
        key: {
          ...(appKey.label !== undefined && { label: appKey.label }),
          value: value.trim(),
        },
        origin,
        slug,
      });
    }
  };
  const outcome = replace.data?.outcome;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <span className="text-sm">{label}</span>
      {outcome === "refused" || outcome === "failed" ? (
        <p className="text-xs text-error-700 dark:text-error-300">
          {outcome === "refused"
            ? `${name} didn’t accept this key, so Instrument kept the old one.`
            : "Instrument couldn’t check this key, so it kept the old one."}
        </p>
      ) : null}
      <Destination origin={origin}>Instrument sends this key to</Destination>
      <div className="flex items-center gap-2">
        <Input
          aria-label={label}
          autoFocus
          className="h-8 flex-1 font-mono text-xs"
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              save();
            }
          }}
          placeholder="Paste the new key"
          type="password"
          value={value}
        />
        <Button disabled={!canSave} onClick={save} size="sm">
          {replace.isPending ? "Checking…" : "Save"}
        </Button>
        <Button
          disabled={replace.isPending}
          onClick={() => {
            setValue("");
            setIsReplacing(false);
          }}
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SavedLine({ appKey }: { appKey: AppKey }) {
  const saved =
    appKey.savedAt === undefined ? undefined : savedOn(appKey.savedAt);
  if (appKey.endsIn === undefined) {
    return saved === undefined ? "Saved" : `Saved ${saved}`;
  }
  return (
    <>
      Ends in{" "}
      <span className="font-mono text-xs text-foreground">{appKey.endsIn}</span>
      {saved === undefined ? null : ` · saved ${saved}`}
    </>
  );
}

/** The day, with its year where that is not this one. */
function savedOn(at: number): string {
  const date = new Date(at);
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}
