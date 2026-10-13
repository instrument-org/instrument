import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { rpcClient } from "@/client/rpc/client";
import { useEffect, useState } from "react";
import { toast } from "@/client/lib/toast";

/** How long a sign-in waits before its link speaks to the email on a phone. */
const EMAIL_HINT_DELAY_MS = 15_000;

/**
 * For a Claude sign-in that stalls away from this computer. Most often
 * Anthropic's email went to a phone, and its code typed into this
 * computer's browser finishes the sign-in. Otherwise the browser cannot get
 * back to this computer (another device, or `localhost` blocked): the person
 * opens Anthropic's sign-in link wherever they like, and pastes the code the
 * page ends on, which goes straight on to Claude Code.
 */
export function ClaudeSignInCode({
  className,
  link,
}: {
  className?: string;
  /** Anthropic's sign-in page that ends on a code. */
  link: string;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setStalled(true);
    }, EMAIL_HINT_DELAY_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, []);

  if (!open) {
    return (
      <p className={className}>
        <button
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => {
            setOpen(true);
          }}
          type="button"
        >
          {stalled
            ? "Got Claude's email on your phone?"
            : "Signing in on another device?"}
        </button>
      </p>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    const result = await rpcClient.claudeAccount.submitSignInCode
      .call({ code })
      .catch(() => ({ error: "Claude didn't accept that code." }));
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      setCode("");
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 text-left text-xs text-muted-foreground">
        <p>
          Type the code from Claude's email into the sign-in page in your
          browser.
        </p>
        <p>
          Or open this sign-in link on another device, sign in there, and paste
          the code Claude shows you here.
        </p>
        <div>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                toast.success("Copied the sign-in link");
              });
            }}
            size="sm"
            variant="outline"
          >
            Copy sign-in link
          </Button>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            aria-label="Code from Claude"
            autoComplete="off"
            className="min-w-0 flex-1"
            onChange={(event) => {
              setCode(event.target.value);
            }}
            placeholder="Paste the code from Claude"
            value={code}
          />
          <Button disabled={!code.trim() || submitting} type="submit">
            Continue
          </Button>
        </form>
        {error && <p className="text-destructive">{error}</p>}
      </div>
    </div>
  );
}
