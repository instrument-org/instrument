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
import {
  MenubarItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
} from "@/client/components/ui/menubar";
import { Spinner } from "@/client/components/ui/spinner";
import { TOPIC_COLORS } from "@/client/components/window/topic-colors";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { formatBytes } from "@instrument-org/workspace/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

/**
 * The dev panel's workspaces: switch between them, make a new one, and clear
 * out old ones. A tool for testing sign-in scenarios side by side, so it is
 * plain rows rather than anything designed.
 */

type WorkspaceColor = RPCOutput["workspaces"]["current"]["color"];
type WorkspaceRow = RPCOutput["workspaces"]["list"]["workspaces"][number];

/**
 * Each workspace color as the deep tier of the topic palette, so a workspace
 * reads in the same hues the app already uses to tell things apart. Hex rather
 * than utility classes: the app's theme defines no hue scales beyond its own.
 */
export const WORKSPACE_COLOR_HEX: Record<WorkspaceColor, string> = {
  blue: TOPIC_COLORS[13] ?? "#007fc3",
  gray: "var(--color-gray-400)",
  green: TOPIC_COLORS[11] ?? "#218b30",
  orange: TOPIC_COLORS[9] ?? "#b85300",
  pink: TOPIC_COLORS[15] ?? "#b2468a",
  purple: TOPIC_COLORS[14] ?? "#765fca",
  red: TOPIC_COLORS[8] ?? "#c0434c",
  teal: TOPIC_COLORS[12] ?? "#009178",
};

const COLORS = Object.keys(WORKSPACE_COLOR_HEX) as WorkspaceColor[];

export function ManageWorkspacesDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    ...rpcClient.workspaces.list.queryOptions(),
    enabled: open,
  });
  const { data: sizes } = useQuery({
    ...rpcClient.workspaces.sizes.queryOptions(),
    enabled: open,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: rpcClient.workspaces.key() });

  const { mutate: remove } = useMutation(
    rpcClient.workspaces.remove.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
      onSuccess: () => {
        toast("Moved to the Trash");
        void refresh();
      },
    }),
  );
  const { mutate: register } = useMutation(
    rpcClient.workspaces.register.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
      onSuccess: () => {
        void refresh();
      },
    }),
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Workspaces</DialogTitle>
          <DialogDescription>
            Delete moves the folder to the Trash.
          </DialogDescription>
        </DialogHeader>
        {/* `min-w-0` because the dialog is a grid: without it a long path sets
            the column's width and pushes the buttons past the edge. */}
        <ul className="min-w-0 divide-y divide-border">
          {data?.workspaces.map((row) => (
            <li className="flex min-w-0 items-center gap-3 py-2" key={row.path}>
              <WorkspaceDot className="size-2" color={row.identity.color} />
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
                  {row.identity.createdBy.kind === "agent" && (
                    <span className="truncate text-xs text-muted-foreground">
                      agent: {row.identity.createdBy.purpose}
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {[
                    formatSize(sizes?.[row.path]),
                    lastOpened(row),
                  ]
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
      </DialogContent>
    </Dialog>
  );
}

export function NewWorkspaceDialog({
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
        toast.error(error.message);
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

export function WorkspaceDot({
  className,
  color,
}: {
  className?: string;
  color: WorkspaceColor;
}) {
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: WORKSPACE_COLOR_HEX[color] }}
    />
  );
}

/** Switch from the dev panel's menu; restarts the app. */
export function WorkspaceMenu({
  onCreate,
  onManage,
}: {
  onCreate: () => void;
  onManage: () => void;
}) {
  const { data } = useQuery(rpcClient.workspaces.list.queryOptions());
  const { mutate: switchTo } = useSwitchWorkspace();
  const registered = data?.workspaces.filter((row) => row.isRegistered) ?? [];
  const current = registered.find((row) => row.isResolved);

  return (
    <MenubarSub>
      <MenubarSubTrigger className="font-mono text-xs">
        Workspace
      </MenubarSubTrigger>
      <MenubarSubContent>
        <MenubarRadioGroup
          onValueChange={(id) => {
            const row = registered.find((candidate) => candidate.id === id);
            if (row) {
              switchTo({ id, name: row.identity.name });
            }
          }}
          value={current?.id}
        >
          {registered.map((row) => (
            <MenubarRadioItem
              className="font-mono text-xs"
              disabled={data?.pinned === true && !row.isResolved}
              key={row.id}
              value={row.id}
            >
              <WorkspaceDot color={row.identity.color} />
              {row.identity.name}
            </MenubarRadioItem>
          ))}
        </MenubarRadioGroup>
        {data?.pinned === true && (
          <MenubarItem className="font-mono text-[10px]" disabled>
            Pinned by INSTRUMENT_WORKSPACE
          </MenubarItem>
        )}
        <MenubarSeparator />
        <MenubarItem className="font-mono text-xs" onSelect={onCreate}>
          New workspace...
        </MenubarItem>
        <MenubarItem className="font-mono text-xs" onSelect={onManage}>
          Manage workspaces...
        </MenubarItem>
      </MenubarSubContent>
    </MenubarSub>
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
    : new Date(row.lastOpenedAt).toLocaleString();
}

/**
 * Switch and restart, saying so while it happens: between the click and the
 * window closing the app asks about running agents and tears down, which is
 * seconds of an unchanged window otherwise.
 */
function useSwitchWorkspace() {
  const { mutate, ...rest } = useMutation(
    rpcClient.workspaces.switch.mutationOptions(),
  );
  const switchTo = (
    { id, name }: { id: string; name: string },
    options?: Parameters<typeof mutate>[1],
  ) => {
    const toastId = toast.loading(`Restarting into ${name}`);
    mutate(
      { id },
      {
        ...options,
        onError: (error, ...more) => {
          toast.error(error.message, { id: toastId });
          options?.onError?.(error, ...more);
        },
        onSuccess: (result, ...more) => {
          if (result.outcome === "canceled") {
            toast("Switch canceled", { id: toastId });
          } else if (result.outcome === "unsupported") {
            toast(
              `${name} opens the next time the app starts: this run cannot restart itself`,
              { id: toastId },
            );
          }
          options?.onSuccess?.(result, ...more);
        },
      },
    );
  };
  return { ...rest, mutate: switchTo };
}
