import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Input } from "@/client/components/ui/input";
import {
  contextMenuComponents,
  dropdownMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { type OpenDestination } from "@/client/hooks/use-open-target";
import { useConnectFromDirectory } from "@/client/components/window/use-connect-from-directory";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  hasFilesView,
  revealInFileManager,
  showInFolder,
  showInFolderLabel,
} from "@/client/lib/show-in-files";
import { toast } from "@/client/lib/toast";
import { osConventions } from "@/client/lib/utils";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, type ReactElement, useRef, useState } from "react";

type App = RPCOutput["apps"]["list"]["apps"][number];

type AppMenuProps = {
  app: App;
  name: string;
  /** Opens the list of every action the app has, where the surface has one. */
  onInspect?: () => void;
  onRemoved?: () => void;
};

/** The dots by an app's name on its front, opening the app's own menu. */
export function AppMenuButton(props: AppMenuProps) {
  const { dialog, items, onCloseAutoFocus } = useAppMenu(props);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`More for ${props.name}`}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            type="button"
          >
            <DotsThreeVerticalIcon className="size-4" weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={onCloseAutoFocus}>
          {items(dropdownMenuComponents)}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  );
}

/**
 * The same menu on a right click over whatever stands for the app, with the
 * ways to open it first, as a right click over any openable thing has them.
 */
export function AppContextMenu({
  children,
  opens,
  ...props
}: AppMenuProps & {
  children: ReactElement;
  opens: OpenDestination[];
}) {
  const { dialog, items, onCloseAutoFocus } = useAppMenu(props);
  return (
    <>
      {/* Not modal, so a click elsewhere while it is up lands where it was aimed. */}
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={onCloseAutoFocus}>
          {/* The places it opens, then the clipboard, as the OS menu groups them. */}
          {opens.map((destination, index) => (
            <Fragment key={destination.id}>
              {destination.id === "copy" && index > 0 ? (
                <ContextMenuSeparator />
              ) : null}
              <ContextMenuItem onSelect={destination.run}>
                {destination.label}
              </ContextMenuItem>
            </Fragment>
          ))}
          {opens.length > 0 ? <ContextMenuSeparator /> : null}
          {items(contextMenuComponents)}
        </ContextMenuContent>
      </ContextMenu>
      {dialog}
    </>
  );
}

/**
 * An app's own menu, authored once for both menu packages: `items` renders
 * the rows under either, and `dialog` is the account-naming dialog they
 * open, mounted beside the menu so it outlives the menu closing.
 */
function useAppMenu({ app, name, onInspect, onRemoved }: AppMenuProps) {
  const { slug } = app;
  const catalog = useQuery(
    rpcClient.apps.live.catalog.experimental_liveOptions(),
  );
  const entry = catalog.data?.find(
    (candidate) => candidate.slug === (app.service ?? slug),
  );
  const { connect, isConnecting } = useConnectFromDirectory();
  const [isNaming, setIsNaming] = useState(false);
  // Asked for in the menu, opened once the menu has let go of the
  // keyboard: a closing menu keeps it while it fades out, so the dialog's
  // field opened any sooner lost it at once.
  const wantsToName = useRef(false);
  const onCloseAutoFocus = (event: Event) => {
    if (wantsToName.current) {
      wantsToName.current = false;
      event.preventDefault();
      setIsNaming(true);
    }
  };

  const isConnected = app.status === "connected";
  const isBrowsable =
    isConnected && (app.type === "mcp" || app.type === "mcp-local");

  const setAccount = useMutation(
    rpcClient.apps.setAccount.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't name the account", { cause: error });
      },
    }),
  );
  const test = useMutation(
    rpcClient.apps.test.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't test ${name}`, { cause: error });
      },
      onSuccess: (report) => {
        if (report.passed) {
          toast.success(`${name} is connected.`);
          return;
        }
        const failure = report.checks.find((check) => check.status === "fail");
        toast.error(`Couldn't connect ${name}`, { cause: failure?.detail });
      },
    }),
  );
  const disconnect = useMutation(
    rpcClient.apps.disconnect.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't disconnect ${name}`, { cause: error });
      },
    }),
  );
  const remove = useMutation(
    rpcClient.apps.remove.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't remove ${name}`, { cause: error });
      },
      onSuccess: () => {
        onRemoved?.();
      },
    }),
  );

  const items = ({ Item, Separator }: MenuComponents) => (
    <>
      {isBrowsable && onInspect ? (
        <Item onSelect={onInspect}>View Actions</Item>
      ) : null}
      <Item
        disabled={test.isPending}
        onSelect={() => {
          test.mutate({ slug });
        }}
      >
        Test Connection
      </Item>
      <Separator />
      <Item
        onSelect={() => {
          wantsToName.current = true;
        }}
      >
        {app.account ? "Rename Account…" : "Name Account…"}
      </Item>
      {entry ? (
        <Item
          disabled={isConnecting}
          onSelect={() => {
            connect(entry, { another: true });
          }}
        >
          Connect Another Account
        </Item>
      ) : null}
      <Separator />
      <Item
        onSelect={() => {
          void showInFolder(app.dir, { kind: "folder" });
        }}
      >
        {showInFolderLabel("folder")}
      </Item>
      {hasFilesView() ? (
        <Item
          onSelect={() => {
            void revealInFileManager(app.dir);
          }}
        >
          {osConventions().showInFileManager}
        </Item>
      ) : null}
      <Separator />
      {isConnected || app.hasCredential ? (
        <Item
          disabled={disconnect.isPending}
          onSelect={() => {
            disconnect.mutate({ slug });
          }}
        >
          Disconnect
        </Item>
      ) : null}
      <Item
        disabled={remove.isPending}
        onSelect={() => {
          remove.mutate({ slug });
        }}
        variant="destructive"
      >
        Remove
      </Item>
    </>
  );

  const dialog = (
    <AccountDialog
      initial={app.account ?? ""}
      name={name}
      onOpenChange={setIsNaming}
      onSave={(account) => {
        setIsNaming(false);
        if (account !== (app.account ?? "")) {
          setAccount.mutate({ account, slug });
        }
      }}
      open={isNaming}
    />
  );

  return { dialog, items, onCloseAutoFocus };
}

/**
 * Names the account an app is signed in as. Saving an empty field clears
 * the name.
 */
function AccountDialog({
  initial,
  name,
  onOpenChange,
  onSave,
  open,
}: {
  initial: string;
  name: string;
  onOpenChange: (open: boolean) => void;
  onSave: (account: string) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent maxWidth="26rem">
        {/* Mounted only while open, so the field starts from the saved name each time. */}
        {open ? (
          <AccountForm
            initial={initial}
            name={name}
            onCancel={() => {
              onOpenChange(false);
            }}
            onSave={onSave}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({
  initial,
  name,
  onCancel,
  onSave,
}: {
  initial: string;
  name: string;
  onCancel: () => void;
  onSave: (account: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(value.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {initial ? "Rename account" : "Name this account"}
        </DialogTitle>
        <DialogDescription>
          A name like your email helps you tell your {name} accounts apart.
        </DialogDescription>
      </DialogHeader>
      <Input
        aria-label="Account name"
        autoFocus
        maxLength={120}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        placeholder="name@example.com"
        value={value}
      />
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}
