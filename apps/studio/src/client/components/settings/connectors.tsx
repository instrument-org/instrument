import { pendingComposePromptAtom } from "@/client/atoms/prompt-value";
import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type CatalogEntry = RPCOutput["connectors"]["catalog"][number];
type Connector = RPCOutput["connectors"]["list"]["connectors"][number];

export function ConnectorsSection() {
  const { data } = useQuery(rpcClient.connectors.list.queryOptions());

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold">Connectors</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Data connectors give the agent authenticated access to external
          services. Credentials are stored encrypted on this computer and are
          never written into connector files or shown to the agent.
        </p>
      </div>

      {data && data.connectors.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No connectors yet. Ask the agent to set one up in a task, e.g.
          &ldquo;connect my Notion&rdquo;.
        </p>
      )}

      {data && data.connectors.length > 0 && (
        <div className="divide-y overflow-hidden rounded-lg border">
          {data.connectors.map((connector) => (
            <ConnectorRow connector={connector} key={connector.slug} />
          ))}
        </div>
      )}

      {data && data.invalid.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Broken connectors
          </h4>
          <div className="divide-y overflow-hidden rounded-lg border">
            {data.invalid.map((entry) => (
              <div className="space-y-0.5 p-3" key={entry.slug}>
                <div className="font-mono text-sm">{entry.slug}</div>
                <p className="text-xs text-muted-foreground">{entry.message}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <ConnectorCatalogSection
        installedSlugs={new Set((data?.connectors ?? []).map((c) => c.slug))}
      />
    </div>
  );
}

function ConnectorCatalogCard({
  entry,
  installed,
}: {
  entry: CatalogEntry;
  installed: boolean;
}) {
  const { addTab } = useTabActions();
  const setPendingPrompt = useSetAtom(pendingComposePromptAtom);
  const closeSettings = useSetAtom(settingsModalAtom);

  const formats = useMemo(
    () => [...new Set(entry.interfaces.map((i) => i.format))],
    [entry.interfaces],
  );

  const startSetup = () => {
    setPendingPrompt(
      `Set up the ${entry.name} connector for me (${entry.domain}).`,
    );
    closeSettings(null);
    void addTab({ to: "/new-tab" }, { select: true });
  };

  return (
    <div className="flex flex-col justify-between gap-2 rounded-lg border p-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{entry.name}</span>
          {installed && (
            <Badge className="shrink-0" variant="secondary">
              Added
            </Badge>
          )}
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {entry.tagline}
        </p>
        <div className="flex flex-wrap gap-1 pt-0.5">
          {formats.map((format) => (
            <span
              className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase"
              key={format}
            >
              {format}
            </span>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={startSetup} size="sm" variant="outline">
          {installed ? "Set up again" : "Set up"}
        </Button>
      </div>
    </div>
  );
}

function ConnectorCatalogSection({
  installedSlugs,
}: {
  installedSlugs: Set<string>;
}) {
  const { data: catalog } = useQuery(
    rpcClient.connectors.catalog.queryOptions(),
  );
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const entries = catalog ?? [];
    const q = query.trim().toLowerCase();
    if (q === "") {
      return entries;
    }
    return entries.filter((entry) =>
      [entry.name, entry.tagline, entry.slug, ...entry.categories]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [catalog, query]);

  if (!catalog) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Browse connectors</h4>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pick a service and the agent will set it up for you, asking for a
          credential only if one is needed.
        </p>
      </div>
      <Input
        className="h-8"
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        placeholder="Search connectors"
        value={query}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {filtered.map((entry) => (
          <ConnectorCatalogCard
            entry={entry}
            installed={installedSlugs.has(entry.slug)}
            key={entry.slug}
          />
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No matches.</p>
      )}
    </section>
  );
}

function ConnectorRow({ connector }: { connector: Connector }) {
  const queryClient = useQueryClient();
  const [credentialDraft, setCredentialDraft] = useState("");

  const invalidateList = () =>
    queryClient.invalidateQueries({
      queryKey: rpcClient.connectors.list.key(),
    });

  const setCredentialMutation = useMutation(
    rpcClient.connectors.setCredential.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't save the credential", {
          description: error.message,
          position: "bottom-center",
        });
      },
      onSuccess: async () => {
        setCredentialDraft("");
        await invalidateList();
        toast.success(`Saved credential for ${connector.displayName}`, {
          position: "bottom-center",
        });
      },
    }),
  );

  const removeCredentialMutation = useMutation(
    rpcClient.connectors.removeCredential.mutationOptions({
      onError: (error) => {
        toast.error(
          `Couldn't remove the credential for ${connector.displayName}`,
          {
            description: error.message,
            position: "bottom-center",
          },
        );
      },
      onSettled: invalidateList,
    }),
  );

  const testMutation = useMutation(
    rpcClient.connectors.test.mutationOptions({
      onError: (error) => {
        toast.error(`Test failed for ${connector.displayName}`, {
          description: error.message,
          position: "bottom-center",
        });
      },
      onSuccess: async (result) => {
        await invalidateList();
        if (result.report.passed) {
          toast.success(`${connector.displayName} is connected`, {
            position: "bottom-center",
          });
        } else {
          const failures = result.report.checks
            .filter((check) => check.status === "fail")
            .map((check) => check.detail)
            .join(" ");
          toast.error(`${connector.displayName} test failed`, {
            description: failures,
            position: "bottom-center",
          });
        }
      },
    }),
  );

  const isOAuth = connector.authKind === "oauth";
  const needsCredential = connector.authKind !== "none" && !isOAuth;

  const startOAuthMutation = useMutation(
    rpcClient.connectors.startOAuth.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't start sign-in for ${connector.displayName}`, {
          description: error.message,
          position: "bottom-center",
        });
      },
      onSuccess: async (result) => {
        if (result.status === "connected") {
          await invalidateList();
          toast.success(`${connector.displayName} is connected`, {
            position: "bottom-center",
          });
        } else {
          toast.info(`Approve ${connector.displayName} in your browser`, {
            description: "Then run Test to finish enabling it.",
            position: "bottom-center",
          });
        }
      },
    }),
  );

  const disconnectMutation = useMutation(
    rpcClient.connectors.disconnectOAuth.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't disconnect ${connector.displayName}`, {
          description: error.message,
          position: "bottom-center",
        });
      },
      onSettled: invalidateList,
    }),
  );

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {connector.displayName}
            </span>
            <Badge variant={connector.enabled ? "default" : "secondary"}>
              {connector.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {connector.slug} · {connector.endpoint}
          </p>
        </div>
        <Button
          disabled={testMutation.isPending}
          onClick={() => {
            testMutation.mutate({ slug: connector.slug });
          }}
          size="sm"
          variant="outline"
        >
          {testMutation.isPending ? "Testing…" : "Test"}
        </Button>
      </div>
      {isOAuth && (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs text-muted-foreground">
            {connector.enabled
              ? "Signed in via OAuth. Tokens are stored encrypted and refresh automatically."
              : "Sign in with your browser -- no API key needed."}
          </p>
          <Button
            disabled={startOAuthMutation.isPending}
            onClick={() => {
              startOAuthMutation.mutate({ slug: connector.slug });
            }}
            size="sm"
            variant="outline"
          >
            {connector.enabled ? "Reconnect" : "Connect"}
          </Button>
          {connector.enabled && (
            <Button
              onClick={() => {
                disconnectMutation.mutate({ slug: connector.slug });
              }}
              size="sm"
              variant="outline"
            >
              Disconnect
            </Button>
          )}
        </div>
      )}
      {needsCredential && (
        <div className="flex items-center gap-2">
          {connector.hasCredential ? (
            <>
              <p className="flex-1 text-xs text-muted-foreground">
                Credential saved (encrypted). It is injected at request time and
                never shown.
              </p>
              <Button
                onClick={() => {
                  removeCredentialMutation.mutate({ slug: connector.slug });
                }}
                size="sm"
                variant="outline"
              >
                Remove
              </Button>
            </>
          ) : (
            <>
              <Input
                className="h-8 flex-1 font-mono text-xs"
                onChange={(event) => {
                  setCredentialDraft(event.target.value);
                }}
                placeholder="Paste API key or token"
                type="password"
                value={credentialDraft}
              />
              <Button
                disabled={
                  credentialDraft.trim() === "" ||
                  setCredentialMutation.isPending
                }
                onClick={() => {
                  setCredentialMutation.mutate({
                    slug: connector.slug,
                    value: credentialDraft.trim(),
                  });
                }}
                size="sm"
              >
                Save
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
