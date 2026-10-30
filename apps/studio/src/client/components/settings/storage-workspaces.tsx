import { displayLocale } from "@/client/lib/display-locale";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Spinner } from "@/client/components/ui/spinner";
import { SettingsSection } from "@/client/components/settings/general-section";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { WORKSPACE_COLOR_HEX } from "@/client/components/window/app-identity-chip";
import { cn, osConventions } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { formatBytes } from "@instrument-org/workspace/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/client/lib/toast";

/**
 * Storage's workspaces, in developer mode: switch between them, make a new
 * one, and clear out old ones. A tool for testing sign-in scenarios side by
 * side, so it is plain rows rather than anything designed.
 */

type WorkspaceColor = RPCOutput["workspaces"]["current"]["color"];
type WorkspaceRow = RPCOutput["workspaces"]["list"]["workspaces"][number];

const COLORS = Object.keys(WORKSPACE_COLOR_HEX) as WorkspaceColor[];

export function StorageWorkspaces() {
  const isDeveloperMode = useDeveloperMode();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<null | SwitchTarget>(null);
  const { data } = useQuery({
    ...rpcClient.workspaces.list.queryOptions(),
    enabled: isDeveloperMode,
  });
  const { data: sizes } = useQuery({
    ...rpcClient.workspaces.sizes.queryOptions(),
    enabled: isDeveloperMode,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: rpcClient.workspaces.key() });

  const { mutate: remove } = useMutation(
    rpcClient.workspaces.remove.mutationOptions({
      onError: (error) => {
        toast.dev(
          `Couldn't move the workspace to the ${osConventions().trash}`,
          {
            description: error.message,
          },
        );
      },
      onSuccess: () => {
        toast.dev(`Moved the workspace to the ${osConventions().trash}`);
        void refresh();
      },
    }),
  );
  const { mutate: register } = useMutation(
    rpcClient.workspaces.register.mutationOptions({
      onError: (error) => {
        toast.dev("Couldn't add the workspace", { description: error.message });
      },
      onSuccess: () => {
        void refresh();
      },
    }),
  );

  if (!isDeveloperMode) {
    return null;
  }

  return (
    <section {...settingAnchor("workspaces")}>
      <SettingsSection developerOnly title="Workspaces">
        <p className="text-sm text-muted-foreground">
          Delete moves a workspace&apos;s .instrument folder to the{" "}
          {osConventions().trash} and leaves the rest of its folder.
          {data?.pinned === true &&
            " INSTRUMENT_WORKSPACE pins this one, so switching is off."}
        </p>
        <div className="overflow-hidden rounded-lg border border-dashed border-dev-700/40 bg-dev-500/5 dark:border-dev-300/30">
          <ul className="min-w-0 divide-y divide-dev-700/20 dark:divide-dev-300/15">
            {data?.workspaces.map((row) => (
              <li
                className="flex min-w-0 items-center gap-3 px-3 py-2"
                key={row.path}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2 text-sm">
                    <span className="truncate font-medium">
                      {row.identity.name}
                    </span>
                    {row.isResolved && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        open
                      </span>
                    )}
                    {!row.isReachable && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        folder not found
                      </span>
                    )}
                    {row.identity.createdBy.kind === "agent" && (
                      <span className="truncate text-xs text-muted-foreground">
                        agent: {row.identity.createdBy.purpose}
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {[row.id, formatSize(sizes?.[row.path]), lastOpened(row)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div
                    className="truncate font-mono text-[10px] text-muted-foreground/70"
                    title={row.path}
                  >
                    {row.path}
                  </div>
                </div>
                {row.isRegistered && !row.isResolved && (
                  <Button
                    className="shrink-0"
                    disabled={data.pinned || !row.isReachable}
                    onClick={() => {
                      setSwitchTarget({ id: row.id, name: row.identity.name });
                    }}
                    size="xs"
                    variant="outline"
                  >
                    Switch
                  </Button>
                )}
                {!row.isRegistered && (
                  <Button
                    className="shrink-0"
                    onClick={() => {
                      register({ path: row.path });
                    }}
                    size="xs"
                    variant="outline"
                  >
                    Add back
                  </Button>
                )}
                {!row.isDefault && (
                  <Button
                    className="shrink-0"
                    disabled={row.deleteBlockedBy !== null}
                    onClick={() => {
                      remove({ path: row.path });
                    }}
                    size="xs"
                    title={row.deleteBlockedBy ?? undefined}
                    variant="destructive"
                  >
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
          size="sm"
          variant="outline"
        >
          New workspace
        </Button>
      </SettingsSection>
      <NewWorkspaceDialog onOpenChange={setCreating} open={creating} />
      <SwitchWorkspaceDialog
        onOpenChange={(open) => {
          if (!open) {
            setSwitchTarget(null);
          }
        }}
        target={switchTarget}
      />
    </section>
  );
}

function NewWorkspaceDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<WorkspaceColor>("blue");
  const [copySignIns, setCopySignIns] = useState(true);
  // Held from Create and open until the app quits: the restart begins only
  // after the running-agent prompt and the quit teardown, a few seconds in
  // which a dismissed dialog would read as nothing happening.
  const [opening, setOpening] = useState(false);
  const { mutate: switchTo } = useSwitchWorkspace();

  const { isPending, mutate: create } = useMutation(
    rpcClient.workspaces.create.mutationOptions({
      onError: (error) => {
        toast.dev("Couldn't make the workspace", {
          description: error.message,
        });
      },
    }),
  );

  const submit = (thenOpen: boolean) => {
    create(
      { color, copySignIns, name },
      {
        onSuccess: ({ id }) => {
          void queryClient.invalidateQueries({
            queryKey: rpcClient.workspaces.key(),
          });
          if (!thenOpen) {
            onOpenChange(false);
            setName("");
            return;
          }
          setOpening(true);
          switchTo(
            { id, name },
            {
              onSettled: (result) => {
                // Still here means the app is not restarting: the prompt was
                // declined or this run cannot restart itself.
                if (result?.outcome !== "relaunching") {
                  setOpening(false);
                  onOpenChange(false);
                }
              },
            },
          );
        },
      },
    );
  };

  const busy = isPending || opening;

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!opening) {
          onOpenChange(next);
        }
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Its own chats, sign-ins, flags, and browser profile.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 py-2"
          id="new-workspace"
          onSubmit={(event) => {
            event.preventDefault();
            submit(true);
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              autoFocus
              disabled={busy}
              id="workspace-name"
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="BYOK only"
              value={name}
            />
          </div>
          <div className="grid gap-2">
            <Label>Color</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COLORS.map((option) => (
                <button
                  aria-label={option}
                  aria-pressed={option === color}
                  className={cn(
                    "size-5 rounded-full ring-offset-2 ring-offset-background",
                    option === color && "ring-2 ring-ring",
                  )}
                  disabled={busy}
                  key={option}
                  onClick={() => {
                    setColor(option);
                  }}
                  style={{ backgroundColor: WORKSPACE_COLOR_HEX[option] }}
                  type="button"
                />
              ))}
            </div>
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={copySignIns}
              disabled={busy}
              onCheckedChange={(checked) => {
                setCopySignIns(checked === true);
              }}
            />
            Copy account and API keys
          </Label>
        </form>
        <DialogFooter>
          <Button
            disabled={busy || name.trim() === ""}
            onClick={() => {
              submit(false);
            }}
            variant="outline"
          >
            Create
          </Button>
          <Button
            disabled={busy || name.trim() === ""}
            form="new-workspace"
            type="submit"
          >
            {opening && <Spinner />}
            {opening ? "Restarting" : "Create and open"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SwitchTarget {
  id: string;
  name: string;
}

/**
 * Confirms a switch, since it restarts the app, and holds through the restart
 * with a spinner: the running-agent prompt and the quit teardown come first,
 * seconds in which a closed dialog would read as nothing happening.
 */
function SwitchWorkspaceDialog({
  onOpenChange,
  target,
}: {
  onOpenChange: (open: boolean) => void;
  target: null | SwitchTarget;
}) {
  const [restarting, setRestarting] = useState(false);
  const { mutate: switchTo } = useSwitchWorkspace();

  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (!restarting) {
          onOpenChange(next);
        }
      }}
      open={target !== null}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch to {target?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The app restarts into it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={restarting}>Cancel</AlertDialogCancel>
          <Button
            disabled={restarting}
            onClick={() => {
              if (!target) {
                return;
              }
              setRestarting(true);
              switchTo(target, {
                onSettled: (result) => {
                  if (result?.outcome !== "relaunching") {
                    setRestarting(false);
                    onOpenChange(false);
                  }
                },
              });
            }}
          >
            {restarting && <Spinner />}
            {restarting ? "Restarting" : "Restart"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Blank until `du` answers, and wherever it cannot (Windows). */
function formatSize(bytes: null | number | undefined) {
  return bytes == null ? null : formatBytes(bytes);
}

function lastOpened(row: WorkspaceRow) {
  if (!row.isRegistered) {
    return "not in the list";
  }
  return row.lastOpenedAt === null
    ? "never opened"
    : new Date(row.lastOpenedAt).toLocaleString(displayLocale);
}

/**
 * Switch and restart. The callers show the wait; this says what happened
 * when the app did not restart after all.
 */
function useSwitchWorkspace() {
  const { mutate, ...rest } = useMutation(
    rpcClient.workspaces.switch.mutationOptions(),
  );
  const switchTo = (
    { id, name }: { id: string; name: string },
    options?: Parameters<typeof mutate>[1],
  ) => {
    mutate(
      { id },
      {
        ...options,
        onError: (error, ...more) => {
          toast.dev("Couldn't switch workspaces", {
            description: error.message,
          });
          options?.onError?.(error, ...more);
        },
        onSuccess: (result, ...more) => {
          if (result.outcome === "canceled") {
            toast.dev("Switch canceled");
          } else if (result.outcome === "unsupported") {
            toast.dev(`${name} opens the next time the app starts`, {
              description: "This run can't restart itself.",
            });
          }
          options?.onSuccess?.(result, ...more);
        },
      },
    );
  };
  return { ...rest, mutate: switchTo };
}
