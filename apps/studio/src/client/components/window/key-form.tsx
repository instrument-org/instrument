import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Destination } from "@/client/components/window/connect-destination";
import { toast } from "@/client/lib/toast";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";

export type AppKey = RPCOutput["apps"]["list"]["apps"][number]["keys"][number];

/**
 * The keys an app asks for: one field alone beside its Save, or a labeled
 * field for each of several over one Save. A field left empty keeps the key
 * already saved, so one that was refused is pasted again on its own.
 */
export function KeyForm({
  alongside,
  askedIn,
  keys,
  name,
  origin,
  slug,
}: {
  /** One more control under the form: the app's page puts its way to ask the agent here. */
  alongside?: ReactNode;
  /** For a card in a chat, the chat, which hears what the user does here. */
  askedIn?: ChatId;
  keys: AppKey[];
  name: string;
  origin: string | undefined;
  slug: string;
}) {
  // By label; an app's one key has none.
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = useRef(new Map<string, HTMLInputElement>());
  const setCredential = useMutation(
    rpcClient.apps.setCredential.mutationOptions({
      onError: (error) => {
        toast.error(
          keys.length > 1 ? "Couldn't save the keys" : "Couldn't save the key",
          { cause: error },
        );
      },
      onSuccess: () => {
        setValues({});
      },
    }),
  );
  const valueOf = (key: AppKey) => (values[key.label ?? ""] ?? "").trim();
  const given = keys.flatMap((key) => {
    const value = valueOf(key);
    return value === ""
      ? []
      : [{ ...(key.label !== undefined && { label: key.label }), value }];
  });
  const isEmpty = (key: AppKey) => valueOf(key) === "" && !key.isSaved;
  const canSave =
    origin !== undefined &&
    !setCredential.isPending &&
    given.length > 0 &&
    !keys.some(isEmpty);
  const save = () => {
    if (canSave) {
      setCredential.mutate({
        ...(askedIn !== undefined && { chatId: askedIn }),
        keys: given,
        origin,
        slug,
      });
    }
  };
  const field = (key: AppKey, index: number) => {
    const id = key.label ?? "";
    return (
      <Input
        aria-label={key.label ?? `${name} key`}
        autoFocus={index === 0}
        className="h-8 flex-1 font-mono text-xs"
        onChange={(event) => {
          const { value } = event.target;
          setValues((current) => ({ ...current, [id]: value }));
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") {
            return;
          }
          const next = keys.find((other) => other !== key && isEmpty(other));
          if (next === undefined) {
            save();
          } else {
            fields.current.get(next.label ?? "")?.focus();
          }
        }}
        placeholder={
          key.endsIn !== undefined
            ? `Saved key ends in ${key.endsIn}`
            : key.label === undefined
              ? `Paste the ${name} key`
              : key.isSaved
                ? "Saved"
                : `Paste the ${inSentence(key.label)}`
        }
        ref={(element) => {
          if (element) {
            fields.current.set(id, element);
          } else {
            fields.current.delete(id);
          }
        }}
        type="password"
        value={values[id] ?? ""}
      />
    );
  };
  const saveButton = (
    <Button disabled={!canSave} onClick={save} size="sm">
      {setCredential.isPending ? "Checking…" : "Save"}
    </Button>
  );
  const [only] = keys;
  return (
    <div className="flex flex-col gap-2">
      <Destination origin={origin}>
        {keys.length > 1
          ? "Instrument sends these keys to"
          : "Instrument sends this key to"}
      </Destination>
      {keys.length > 1 ? (
        <div className="flex flex-col gap-2.5">
          {keys.map((key, index) => (
            <div className="flex flex-col gap-1" key={key.label}>
              <span className="text-xs font-medium">{key.label}</span>
              <div className="flex">{field(key, index)}</div>
            </div>
          ))}
          <div className="flex">{saveButton}</div>
        </div>
      ) : only ? (
        <div className="flex items-center gap-2">
          {field(only, 0)}
          {saveButton}
        </div>
      ) : null}
      {alongside ? (
        <div className="flex flex-wrap gap-2">{alongside}</div>
      ) : null}
    </div>
  );
}

/** A key's name in the middle of a sentence: "Application key" loses its capital, "API key" keeps its own. */
function inSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label)
    ? label.charAt(0).toLowerCase() + label.slice(1)
    : label;
}
