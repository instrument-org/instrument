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
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
} from "@/client/components/ui/menubar";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { formatBytes } from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
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

const DOT_CLASS: Record<WorkspaceColor, string> = {
  blue: "bg-blue-500",
  gray: "bg-gray-400",
  green: "bg-green-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  purple: "bg-purple-500",
  red: "bg-red-500",
  teal: "bg-teal-500",
};

const COLORS = Object.keys(DOT_CLASS) as WorkspaceColor[];

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
      onSuccess: () => {
        void refresh();
      },
    }),
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Workspaces</DialogTitle>
          <DialogDescription>
            Delete moves the workspace folder to the Trash. The default
            workspace and the open one stay.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border">
          {data?.workspaces.map((row) => (
            <li className="flex items-center gap-3 py-2" key={row.path}>
              <WorkspaceDot className="size-2" color={row.identity.color} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-medium">{row.identity.name}</span>
                  {row.identity.createdBy.kind === "agent" && (
                    <span className="text-xs text-muted-foreground">
                      agent: {row.identity.createdBy.purpose}
                    </span>
                  )}
                  {row.isResolved && (
                    <span className="text-xs text-muted-foreground">open</span>
                  )}
                </div>
                <div
                  className="truncate font-mono text-[10px] text-muted-foreground"
                  title={row.path}
                >
                  {row.sizeBytes === null
                    ? ""
                    : `${formatBytes(row.sizeBytes)} · `}
                  {lastOpened(row)} · {row.path}
                </div>
              </div>
              {!row.isRegistered && (
                <Button
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
  const [copySignIns, setCopySignIns] = useState(false);
  const { mutate: switchTo } = useSwitchWorkspace();

  const { isPending, mutate: create } = useMutation(
    rpcClient.workspaces.create.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const submit = (thenSwitch: boolean) => {
    create(
      { color, copySignIns, name },
      {
        onSuccess: ({ id }) => {
          void queryClient.invalidateQueries({
            queryKey: rpcClient.workspaces.key(),
          });
          onOpenChange(false);
          setName("");
          if (thenSwitch) {
            switchTo({ id });
          }
        },
      },
    );
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Its own chats, sign-ins, keys, flags, and browser profile. Opening
            it restarts the app.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              autoFocus
              id="workspace-name"
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="BYOK only"
              value={name}
            />
          </div>
          <div className="flex items-center gap-2">
            {COLORS.map((option) => (
              <button
                aria-label={option}
                aria-pressed={option === color}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background",
                  option === color && "ring-2 ring-ring",
                )}
                key={option}
                onClick={() => {
                  setColor(option);
                }}
                type="button"
              >
                <WorkspaceDot className="size-4" color={option} />
              </button>
            ))}
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={copySignIns}
              onCheckedChange={(checked) => {
                setCopySignIns(checked === true);
              }}
            />
            Copy the account and API keys from this workspace (sign in to a
            ChatGPT plan again)
          </Label>
        </div>
        <DialogFooter>
          <Button
            disabled={isPending || name.trim() === ""}
            onClick={() => {
              submit(false);
            }}
            variant="outline"
          >
            Create
          </Button>
          <Button
            disabled={isPending || name.trim() === ""}
            onClick={() => {
              submit(true);
            }}
          >
            Create and open
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
      className={cn(
        "inline-block size-1.5 rounded-full",
        DOT_CLASS[color],
        className,
      )}
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

  return (
    <MenubarSub>
      <MenubarSubTrigger className="font-mono text-xs">
        Workspace
      </MenubarSubTrigger>
      <MenubarSubContent>
        {registered.map((row) => (
          <MenubarItem
            className="font-mono text-xs"
            disabled={row.isResolved || data?.pinned === true}
            key={row.id}
            onSelect={() => {
              switchTo({ id: row.id });
            }}
          >
            <WorkspaceDot color={row.identity.color} />
            {row.identity.name}
            {row.isResolved && <CheckIcon className="ml-auto size-3" />}
          </MenubarItem>
        ))}
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

function lastOpened(row: WorkspaceRow) {
  if (!row.isRegistered) {
    return "not in the list";
  }
  return row.lastOpenedAt === null
    ? "never opened"
    : new Date(row.lastOpenedAt).toLocaleString();
}

function useSwitchWorkspace() {
  return useMutation(
    rpcClient.workspaces.switch.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
      onSuccess: ({ outcome }) => {
        if (outcome === "unsupported") {
          toast(
            "Quit and start the app again to open it: this run cannot restart itself",
          );
        }
        if (outcome === "canceled") {
          toast("Switch canceled; the workspace stays as it was");
        }
      },
    }),
  );
}
