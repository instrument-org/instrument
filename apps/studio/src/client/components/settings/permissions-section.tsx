import { SANDBOX_OFF_URL, WINDOWS_SANDBOX_URL } from "@instrument-org/shared";
import { SendReportButton } from "@/client/components/report-error-button";
import { conditionReport } from "@/client/lib/problem-reports";
import { FolderRow } from "@/client/components/folder-row";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { useComputerVolumes } from "@/client/components/window/computer-volumes";
import { FoldersMark } from "@/client/components/window/folder-mark";
import { isInside, nameOf } from "@/client/components/window/host-path";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { displayPath } from "@/client/lib/path-utils";
import { privacyPaneForApp } from "@/client/lib/privacy-pane";
import { isLinux, isWindows } from "@/client/lib/utils";
import { toast } from "@/client/lib/toast";
import { cn, osConventions } from "@/client/lib/utils";
import { SANDBOX_OFF_COPY, SANDBOX_OFF_REASONS } from "@/shared/sandbox-off";
import { MacAppIcon } from "@/client/components/mac-app-icon";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CloudIcon } from "@phosphor-icons/react/Cloud";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { HouseIcon } from "@phosphor-icons/react/House";
import { ImagesIcon } from "@phosphor-icons/react/Images";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { KeyIcon } from "@phosphor-icons/react/Key";
import { MinusCircleIcon } from "@phosphor-icons/react/MinusCircle";
import { MusicNotesIcon } from "@phosphor-icons/react/MusicNotes";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

type View = RPCOutput["workspace"]["permissions"]["get"];
type Level = View["folders"][number]["level"];
type Place = View["places"][number];
type Folder = View["folders"][number];

const LEVEL_LABELS = {
  allow: "Allowed",
  ask: "Ask first",
  never: "Not allowed",
} satisfies Record<Level, string>;

const LEVELS = ["allow", "ask", "never"] satisfies Level[];

/** The places the list always draws, in its order; the Instrument folder is with the folders every chat can use. */
const PLACE_ORDER = [
  "desktop",
  "documents",
  "downloads",
  "icloud",
  "drives",
  "appFiles",
  "photos",
  "mediaLibraries",
  "passwords",
] as const;

/**
 * The folders the person answered for, each under the place it is in: the
 * deepest place holding it, where places sit one inside another (iCloud
 * Drive in the apps' Library). A folder in no place is the list's to put at
 * its end.
 */
function nestFolders(places: Place[], folders: Folder[]) {
  const under = new Map<Place["id"], Folder[]>();
  const elsewhere: Folder[] = [];
  for (const folder of folders) {
    const holder = places
      .flatMap((place) =>
        place.paths
          .filter((placePath) => isInside(folder.path, placePath))
          .map((placePath) => ({ length: placePath.length, place })),
      )
      .toSorted((a, b) => b.length - a.length)[0]?.place;
    if (holder) {
      under.set(holder.id, [...(under.get(holder.id) ?? []), folder]);
    } else {
      elsewhere.push(folder);
    }
  }
  return { elsewhere, under };
}

export function PermissionsSection() {
  const queryClient = useQueryClient();
  const openLink = useOpenExternalLink();
  const [confirmingWithoutAsking, setConfirmingWithoutAsking] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const { data: view } = useQuery(
    rpcClient.workspace.permissions.get.queryOptions(),
  );
  // What macOS keeps out of what the person allowed, asked again as the
  // window comes back from System Settings.
  const { data: macos } = useQuery({
    ...rpcClient.workspace.permissions.macos.queryOptions(),
    refetchOnWindowFocus: "always",
  });
  const blockedByMacos = (path: string) =>
    (macos?.folders ?? []).some(
      (root) => isInside(path, root) || isInside(root, path),
    );
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.permissions.key(),
    });
  };
  const onError = (error: Error) => {
    toast.error("Couldn't change that setting", { cause: error });
  };
  const setPlace = useMutation(
    rpcClient.workspace.permissions.setPlace.mutationOptions({
      onError,
      onSuccess: refresh,
    }),
  );
  const setFolder = useMutation(
    rpcClient.workspace.permissions.setFolder.mutationOptions({
      onError,
      onSuccess: refresh,
    }),
  );
  const removeFolder = useMutation(
    rpcClient.workspace.permissions.removeFolder.mutationOptions({
      onError,
      onSuccess: refresh,
    }),
  );
  const setApp = useMutation(
    rpcClient.workspace.permissions.setApp.mutationOptions({
      onError,
      onSuccess: refresh,
    }),
  );
  const removeApp = useMutation(
    rpcClient.workspace.permissions.removeApp.mutationOptions({
      onError,
      onSuccess: refresh,
    }),
  );
  const setDangerouslyAllowEveryFolder = useMutation(
    rpcClient.workspace.permissions.setDangerouslyAllowEveryFolder.mutationOptions(
      {
        onError,
        onSuccess: refresh,
      },
    ),
  );

  const reset = useMutation(
    rpcClient.workspace.permissions.reset.mutationOptions({
      onError,
      onSuccess: refresh,
    }),
  );

  if (!view) {
    return null;
  }

  const addFolder = async () => {
    const picked = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Add",
    });
    if (!picked) {
      return;
    }
    setFolder.mutate({ level: "allow", path: picked.path });
  };

  const withoutAsking = view.dangerouslyAllowEveryFolder;
  const placeById = new Map(view.places.map((place) => [place.id, place]));
  const places = PLACE_ORDER.flatMap((id) => {
    const place = placeById.get(id);
    return place ? [place] : [];
  });
  const { elsewhere, under } = nestFolders(places, view.folders);
  const folderRow = (folder: Folder, { indent }: { indent: boolean }) => {
    const isHome = folder.path === view.home;
    const remove = () => {
      removeFolder.mutate({ path: folder.path });
    };
    return (
      <FolderRow
        end={
          <LevelSelect
            label={nameOf(folder.path)}
            level={folder.level}
            onRemove={remove}
            onSelect={(level) => {
              setFolder.mutate({ level, path: folder.path });
            }}
          />
        }
        indent={indent}
        key={folder.path}
        {...(folder.level === "allow" && blockedByMacos(folder.path)
          ? { note: <BlockedByMacos pane="FilesAndFolders" /> }
          : {})}
        menu={[
          {
            icon: <MinusCircleIcon className="size-4" />,
            label: "Remove",
            onSelect: remove,
          },
        ]}
        {...(isHome
          ? { mark: <HouseIcon className="size-6 text-muted-foreground" /> }
          : {})}
        path={folder.path}
      />
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold">Permissions</h3>
        <p className="text-sm text-muted-foreground">
          Instrument asks you in a chat the first time it needs a folder or an
          app. You can change your answer here anytime.
        </p>
      </div>
      {view.sandboxOff === "windows" ? (
        <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            On Windows, Instrument's own tools follow this list, but programs
            the agent runs, including its Python and Node scripts, can reach any
            file you can. That changes once Instrument can use Windows' own
            sandbox.{" "}
            <button
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                openLink(WINDOWS_SANDBOX_URL, { addReferral: false });
              }}
              type="button"
            >
              Learn more
            </button>
          </p>
        </div>
      ) : view.sandboxOff ? (
        <SandboxOffWarning off={view.sandboxOff} openLink={openLink} />
      ) : null}
      <section className="space-y-2">
        <div
          className="flex items-center justify-between gap-2"
          {...settingAnchor("use-folders-without-asking")}
        >
          <h4 className="text-sm font-medium text-muted-foreground">Folders</h4>
          <div className="flex shrink-0 gap-2">
            <Button
              onClick={() => {
                void addFolder();
              }}
              size="sm"
              variant="outline"
            >
              <PlusIcon className="size-4" />
              Add folder…
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="More" size="icon-sm" variant="outline">
                  <DotsThreeIcon className="size-4" weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {withoutAsking ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setDangerouslyAllowEveryFolder.mutate({
                        dangerouslyAllowEveryFolder: false,
                      });
                    }}
                  >
                    <ShieldWarningIcon className="size-4" />
                    <span>Ask before using folders</span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => {
                      setConfirmingWithoutAsking(true);
                    }}
                    variant="destructive"
                  >
                    <ShieldWarningIcon className="size-4" />
                    <span>Use folders without asking…</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {withoutAsking ? (
          <div
            className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/8 p-3"
            role="status"
          >
            <ShieldWarningIcon className="mt-0.5 size-4.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium text-destructive">
                Instrument uses folders without asking
              </p>
              <p className="text-xs text-muted-foreground">
                It reads and changes any folder that isn’t marked Not allowed.
                It still asks before using your passwords and keys.
              </p>
            </div>
            <Button
              onClick={() => {
                setDangerouslyAllowEveryFolder.mutate({
                  dangerouslyAllowEveryFolder: false,
                });
              }}
              size="sm"
              variant="outline"
            >
              Turn off
            </Button>
          </div>
        ) : null}
        <div
          className={cn(
            "divide-y overflow-hidden rounded-lg border",
            withoutAsking && "opacity-45",
          )}
        >
          {places.map((place) => [
            <PlaceRow
              blocked={
                place.level === "allow" && place.paths.some(blockedByMacos)
              }
              home={view.home}
              key={place.id}
              onSelect={(level) => {
                if (place.id !== "output") {
                  setPlace.mutate({ id: place.id, level });
                }
              }}
              place={place}
            />,
            ...(under.get(place.id) ?? []).map((folder) =>
              folderRow(folder, { indent: true }),
            ),
          ])}
          {elsewhere.map((folder) => folderRow(folder, { indent: false }))}
        </div>
      </section>
      <section className={cn("space-y-2", withoutAsking && "opacity-45")}>
        <h4 className="text-sm font-medium text-muted-foreground">Apps</h4>
        {view.apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Instrument hasn’t asked to control any apps yet.
          </p>
        ) : (
          <div className="divide-y overflow-hidden rounded-lg border">
            {view.apps.map((app) => (
              <div className="flex items-center gap-3 p-3" key={app.name}>
                <span className="flex w-7 shrink-0 justify-center">
                  <MacAppIcon app={app.name} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{app.name}</span>
                  {app.level === "allow" && macos?.apps.includes(app.name) ? (
                    <BlockedByMacos pane={privacyPaneForApp(app.name)} />
                  ) : null}
                </span>
                <LevelSelect
                  label={app.name}
                  level={app.level}
                  onRemove={() => {
                    removeApp.mutate({ name: app.name });
                  }}
                  onSelect={(level) => {
                    setApp.mutate({ level, name: app.name });
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
      <EveryChatCanUse
        appFiles={placeById.get("appFiles")?.level}
        output={placeById.get("output")?.paths[0]}
        places={view.alwaysOpen}
      />
      {view.untouched ? null : (
        <button
          className="w-full rounded-lg border bg-card p-4 text-left text-sm text-destructive hover:bg-muted/50"
          onClick={() => {
            setConfirmingReset(true);
          }}
          type="button"
          {...settingAnchor("reset-permissions")}
        >
          Reset permissions
        </button>
      )}
      <AlertDialog onOpenChange={setConfirmingReset} open={confirmingReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset permissions?</AlertDialogTitle>
            <AlertDialogDescription>
              Every folder and app goes back to how it was when you installed
              Instrument, and chats will ask again before using anything you
              allowed in them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                reset.mutate(undefined);
              }}
              variant="destructive"
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={setConfirmingWithoutAsking}
        open={confirmingWithoutAsking}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use folders without asking?</AlertDialogTitle>
            <AlertDialogDescription>
              Instrument will read and change any folder that isn’t marked Not
              allowed, without checking with you first. It still asks before
              using your passwords and keys.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDangerouslyAllowEveryFolder.mutate({
                  dangerouslyAllowEveryFolder: true,
                });
              }}
              variant="destructive"
            >
              Use Without Asking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The folders every chat reaches whatever the list above says, because the
 * app needs them, folded away since nothing in them is the person's to set,
 * and what programs can see without asking.
 */
function EveryChatCanUse({
  appFiles,
  output,
  places,
}: {
  appFiles: Level | undefined;
  output: string | undefined;
  places: View["alwaysOpen"];
}) {
  const rows: {
    line?: string;
    mark?: ReactNode;
    name: string;
    path: string;
    status: string;
  }[] = [
    ...(output
      ? [{ name: "Instrument folder", path: output, status: "Always allowed" }]
      : []),
    {
      name: "Each chat’s files",
      path: places.workFolders,
      status: "Always allowed",
    },
    { name: "Past chats", path: places.chats, status: "Read only" },
    ...(places.caches.length > 0
      ? [
          {
            line: places.caches.map((each) => displayPath(each)).join(", "),
            mark: <FoldersMark />,
            name: "Caches",
            path: places.caches[0] ?? "",
            status: appFiles === "never" ? "Not allowed" : "Always allowed",
          },
        ]
      : []),
    ...places.programs.map((path) => ({
      name: "Installed programs",
      path,
      status: "Read only",
    })),
  ];
  const listed = appFiles === "ask" && !isLinux();
  return (
    <Collapsible className="space-y-2" {...settingAnchor("always-open")}>
      <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-muted-foreground">
        <CaretRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        Folders every chat can use
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Every chat can use these, since Instrument needs them to work. A chat
          can read your past chats but can’t change them, and your browsers’
          caches stay closed.
        </p>
        <div className="divide-y overflow-hidden rounded-lg border">
          {rows.map((row) => (
            <FolderRow
              end={
                <span className="shrink-0 px-3 text-sm text-muted-foreground">
                  {row.status}
                </span>
              }
              key={`${row.name}:${row.path}`}
              {...(row.line === undefined ? {} : { line: row.line })}
              {...(row.mark === undefined ? {} : { mark: row.mark })}
              name={row.name}
              path={row.path}
            />
          ))}
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          {isWindows() ? (
            <p>
              {listed
                ? "Programs the agent runs can see the names of what's in Other apps' files, and in a folder set to Ask first when you've allowed a folder inside it. Instrument still asks you before a program opens anything there."
                : "Programs the agent runs can see the names of what's in a folder set to Ask first when you've allowed a folder inside it. Instrument still asks you before a program opens anything there."}
            </p>
          ) : listed ? (
            <p>
              Programs the agent runs can see the names, sizes and dates of
              what's in Other apps' files, but Instrument asks you before a
              program opens anything there.
            </p>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// oxlint-disable-next-line studio/no-os-words -- macOS alone keeps a folder or app from the app this way, so this shows only there
/** The line under a row macOS keeps out though the person allowed it, with the way to its pane. */
function BlockedByMacos({
  pane,
}: {
  pane:
    | "Automation"
    | "Calendars"
    | "Contacts"
    | "FilesAndFolders"
    | "Reminders";
}) {
  const open = useMutation(
    rpcClient.features.openPrivacySettings.mutationOptions(),
  );
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-warning-700 dark:text-warning-300">
      <ShieldWarningIcon className="size-3.5 shrink-0" />
      {/* oxlint-disable-next-line studio/no-os-words -- shown only on a Mac */}
      <span>Your Mac is blocking this.</span>
      <button
        className="font-medium underline underline-offset-2"
        onClick={() => {
          open.mutate({ pane });
        }}
        type="button"
      >
        {/* oxlint-disable-next-line studio/no-os-words -- shown only on a Mac */}
        Open System Settings
      </button>
    </span>
  );
}

function PlaceRow({
  blocked,
  home,
  onSelect,
  place,
}: {
  /** Whether macOS keeps the place from the app though the person allowed it. */
  blocked: boolean;
  home: string;
  onSelect: (level: Level) => void;
  place: Place;
}) {
  const className = "size-6 text-muted-foreground";
  const volumes = useComputerVolumes();
  const paths = place.paths.map((each) => displayPath(each)).join(", ");
  const details = ((): {
    line?: null | string;
    mark?: ReactNode;
    name: string;
  } => {
    switch (place.id) {
      case "output": {
        return { name: "Instrument folder" };
      }
      case "desktop":
      case "documents":
      case "downloads": {
        return {
          name: {
            desktop: "Desktop",
            documents: "Documents",
            downloads: "Downloads",
          }[place.id],
        };
      }
      case "icloud": {
        return {
          line: null,
          mark: <CloudIcon className={className} />,
          name: "iCloud Drive",
        };
      }
      case "drives": {
        // Windows names every drive but the system one, inside or plugged in,
        // each the way File Explorer does.
        return isWindows()
          ? {
              line:
                place.paths
                  .map(
                    (root) =>
                      volumes?.find((volume) => volume.path === root)?.name ??
                      root.replace(/\\$/, ""),
                  )
                  .join(", ") || null,
              mark: <HardDriveIcon className={className} />,
              name: "Other drives",
            }
          : {
              line: paths || null,
              mark: <HardDriveIcon className={className} />,
              name: "Drives you plug in",
            };
      }
      case "appFiles": {
        return {
          line: paths || null,
          mark: <FoldersMark />,
          name: "Other apps’ files",
        };
      }
      case "photos": {
        return {
          line: paths || null,
          mark: <ImagesIcon className={className} />,
          name: "Photos library",
        };
      }
      case "mediaLibraries": {
        return {
          line: paths || null,
          mark: <MusicNotesIcon className={className} />,
          name: "Music and TV libraries",
        };
      }
      case "passwords": {
        // Asking first covers the sign-in folders alone; the browsers and
        // the system's password store open only when the whole place is
        // allowed.
        const { passwordStore } = osConventions();
        return {
          line:
            place.level === "ask"
              ? passwordStore
                ? `Folders like .ssh ask first. Your browsers and ${passwordStore} stay closed.`
                : "Folders like .ssh ask first. Your browsers stay closed."
              : "Keys, sign-ins and browser cookies",
          mark: <KeyIcon className={className} />,
          name: "Passwords and keys",
        };
      }
      default: {
        place.id satisfies never;
        return { name: "" };
      }
    }
  })();
  // A place with no folder of its own here (iCloud Drive signed out, say)
  // has nothing to open or copy.
  const path = place.paths[0] ?? home;
  return (
    <FolderRow
      end={
        <LevelSelect
          label={details.name}
          level={place.level}
          onSelect={onSelect}
        />
      }
      {...(details.line === undefined ? {} : { line: details.line })}
      {...(details.mark === undefined ? {} : { mark: details.mark })}
      {...(blocked ? { note: <BlockedByMacos pane="FilesAndFolders" /> } : {})}
      name={details.name}
      path={path}
    />
  );
}

function LevelSelect({
  label,
  level,
  onRemove,
  onSelect,
}: {
  label: string;
  level: Level;
  onRemove?: () => void;
  onSelect: (level: Level) => void;
}) {
  return (
    <Select
      onValueChange={(value) => {
        if (value === "remove") {
          onRemove?.();
          return;
        }
        const chosen = LEVELS.find((each) => each === value);
        if (chosen) {
          onSelect(chosen);
        }
      }}
      value={level}
    >
      <SelectTrigger
        aria-label={`Access for ${label}`}
        className="bg-card bg-none dark:bg-gray-700"
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" position="popper">
        {LEVELS.map((each) => (
          <SelectItem key={each} value={each}>
            {LEVEL_LABELS[each]}
          </SelectItem>
        ))}
        {onRemove ? (
          <>
            <SelectSeparator />
            <SelectItem value="remove">Remove</SelectItem>
          </>
        ) : null}
      </SelectContent>
    </Select>
  );
}

/**
 * Where no sandbox can hold the programs the agent runs: why, and the
 * person's choice to run them anyway, which stays here while it is on.
 */
function SandboxOffWarning({
  off,
  openLink,
}: {
  off: Exclude<View["sandboxOff"], "windows" | undefined>;
  openLink: ReturnType<typeof useOpenExternalLink>;
}) {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setRunAnyway = useMutation(
    rpcClient.preferences.setRunProgramsWithoutSandbox.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change that setting", { cause: error });
      },
    }),
  );
  const allowed = preferences?.runProgramsWithoutSandbox === true;
  const copy = SANDBOX_OFF_COPY[allowed ? "allowed" : "refused"];
  return (
    <Alert variant="warning">
      <ShieldWarningIcon />
      <AlertTitle className="line-clamp-none">{copy.title}</AlertTitle>
      <AlertDescription>
        <p>{SANDBOX_OFF_REASONS[off]}</p>
        <p>
          {copy.settings} Once you've changed something, quit and reopen
          Instrument so it checks again.
        </p>
        <label className="mt-1 flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-card p-3">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-foreground">
              Run programs without a sandbox
            </span>
            <span className="block text-xs">
              They'll be able to reach any file you can on this computer.
            </span>
          </span>
          <Switch
            checked={allowed}
            disabled={preferences === undefined || setRunAnyway.isPending}
            onCheckedChange={(enabled) => {
              setRunAnyway.mutate({ enabled });
            }}
          />
        </label>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              openLink(SANDBOX_OFF_URL, { addReferral: false });
            }}
            size="sm"
            variant="outline"
          >
            Learn more
          </Button>
          <SendReportButton
            request={(onSent) =>
              conditionReport({
                condition: "sandbox-off",
                onSent,
                title: copy.title,
              })
            }
            size="sm"
          />
        </div>
      </AlertDescription>
    </Alert>
  );
}
