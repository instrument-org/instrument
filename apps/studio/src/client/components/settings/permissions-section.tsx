import { SANDBOX_OFF_URL, WINDOWS_SANDBOX_URL } from "@instrument-org/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import { PlaceIcon } from "@/client/components/window/place-icons";
import { useComputerVolumes } from "@/client/components/window/computer-volumes";
import { FolderMark } from "@/client/components/window/folder-mark";
import {
  isInside,
  nameOf,
  segmentsOf,
} from "@/client/components/window/host-path";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { isLinux, isWindows } from "@/client/lib/utils";
import { toast } from "@/client/lib/toast";
import { cn, osConventions } from "@/client/lib/utils";
import { SANDBOX_OFF_REASONS, SANDBOX_OFF_TITLE } from "@/shared/sandbox-off";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CloudIcon } from "@phosphor-icons/react/Cloud";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { HouseIcon } from "@phosphor-icons/react/House";
import { ImagesIcon } from "@phosphor-icons/react/Images";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { KeyIcon } from "@phosphor-icons/react/Key";
import { MusicNotesIcon } from "@phosphor-icons/react/MusicNotes";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";

type View = RPCOutput["workspace"]["permissions"]["get"];
type Level = View["folders"][number]["level"];
type Place = View["places"][number];

const SEPARATOR = " › ";

const LEVEL_LABELS = {
  allow: "Allowed",
  ask: "Ask first",
  never: "Not allowed",
} satisfies Record<Level, string>;

const LEVELS = ["allow", "ask", "never"] satisfies Level[];

/** A path from the home folder down, with the folder's own name left off when it is home. */
function fromHome(path: string, home: string) {
  const names = segmentsOf(path);
  return (
    isInside(path, home) ? names.slice(segmentsOf(home).length) : names
  ).join(SEPARATOR);
}

export function PermissionsSection() {
  const queryClient = useQueryClient();
  const openLink = useOpenExternalLink();
  const { data: view } = useQuery(
    rpcClient.workspace.permissions.get.queryOptions(),
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

  const placeById = new Map(view.places.map((place) => [place.id, place]));
  const passwordsAsk = placeById.get("passwords")?.level === "ask";
  const placeRows = (
    [
      "output",
      "desktop",
      "documents",
      "downloads",
      "icloud",
      "drives",
      "appFiles",
      "photos",
      "mediaLibraries",
      "passwords",
    ] as const
  ).flatMap((id) => {
    const place = placeById.get(id);
    return place ? [place] : [];
  });

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold" {...settingAnchor("permissions")}>
        Permissions
      </h3>
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
        <Alert variant="warning">
          <ShieldWarningIcon />
          <AlertTitle className="line-clamp-none">
            {SANDBOX_OFF_TITLE}
          </AlertTitle>
          <AlertDescription>
            <p>{SANDBOX_OFF_REASONS[view.sandboxOff]}</p>
            <p>
              Instrument's own tools still follow this list, but a program the
              agent runs, like a Python script, can reach any file you can. Once
              you've changed something, quit and reopen Instrument so it checks
              again.
            </p>
            <Button
              className="mt-1"
              onClick={() => {
                openLink(SANDBOX_OFF_URL, { addReferral: false });
              }}
              size="sm"
              variant="outline"
            >
              Learn more
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <Card className="p-0" {...settingAnchor("use-folders-without-asking")}>
        <label className="flex items-center justify-between gap-4 p-4">
          <span className="space-y-1">
            <span className="block text-sm font-medium">
              Use folders without asking
            </span>
            <span className="block text-xs text-muted-foreground">
              {view.dangerouslyAllowEveryFolder
                ? passwordsAsk
                  ? "Instrument uses any folder that isn't marked Not allowed, but still asks before using your passwords and keys."
                  : "Instrument uses any folder that isn't marked Not allowed."
                : "When a chat needs a folder marked Ask first, Instrument asks you in that chat."}
            </span>
          </span>
          <Switch
            checked={view.dangerouslyAllowEveryFolder}
            onCheckedChange={(dangerouslyAllowEveryFolder) => {
              setDangerouslyAllowEveryFolder.mutate({
                dangerouslyAllowEveryFolder,
              });
            }}
          />
        </label>
      </Card>
      <div
        className={cn(
          "space-y-6",
          view.dangerouslyAllowEveryFolder && "opacity-45",
        )}
      >
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Your folders
          </h4>
          <div className="divide-y overflow-hidden rounded-lg border">
            {view.folders.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                Instrument hasn't asked to use any other folders yet.
              </p>
            ) : (
              view.folders.map((folder) => {
                const isHome = folder.path === view.home;
                const where = fromHome(folder.path, view.home);
                return (
                  <PermissionRow
                    control={
                      <LevelSelect
                        label={nameOf(folder.path)}
                        level={folder.level}
                        onRemove={() => {
                          removeFolder.mutate({ path: folder.path });
                        }}
                        onSelect={(level) => {
                          setFolder.mutate({ level, path: folder.path });
                        }}
                      />
                    }
                    key={folder.path}
                    // A folder directly in the home folder has no more to say
                    // than its name.
                    line={
                      isHome || where === nameOf(folder.path)
                        ? undefined
                        : where
                    }
                    mark={
                      isHome ? (
                        <HouseIcon className="size-6 text-muted-foreground" />
                      ) : (
                        <FolderMark size="row" path={folder.path} />
                      )
                    }
                    name={nameOf(folder.path)}
                  />
                );
              })
            )}
          </div>
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
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Your apps
          </h4>
          <div className="divide-y overflow-hidden rounded-lg border">
            {view.apps.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                Instrument hasn't asked to control any apps yet.
              </p>
            ) : (
              view.apps.map((app) => (
                <PermissionRow
                  control={
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
                  }
                  key={app.name}
                  line={undefined}
                  mark={
                    <AppWindowIcon className="size-6 text-muted-foreground" />
                  }
                  name={app.name}
                />
              ))
            )}
          </div>
        </div>
        <Collapsible className="space-y-2">
          <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-muted-foreground">
            <CaretRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            {`Places on your ${osConventions().computerKind}`}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y overflow-hidden rounded-lg border">
              {placeRows.map((place) => (
                <PlaceRow
                  home={view.home}
                  key={place.id}
                  onSelect={(level) => {
                    if (place.id !== "output") {
                      setPlace.mutate({ id: place.id, level });
                    }
                  }}
                  place={place}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <AlwaysOpen
        appFiles={placeById.get("appFiles")?.level}
        home={view.home}
        places={view.alwaysOpen}
      />
    </div>
  );
}

/**
 * The places every chat reaches whatever the list above says, because the
 * app needs them, and what programs can see without asking.
 */
function AlwaysOpen({
  appFiles,
  home,
  places,
}: {
  appFiles: Level | undefined;
  home: string;
  places: View["alwaysOpen"];
}) {
  const status = (text: string) => (
    <span className="px-3 text-sm text-muted-foreground">{text}</span>
  );
  const rows = [
    {
      line: fromHome(places.workFolders, home),
      name: "Chat work folders",
      path: places.workFolders,
      status: "Allowed",
    },
    {
      line: fromHome(places.chats, home),
      name: "Chat history",
      path: places.chats,
      status: "Read only",
    },
    ...(places.caches.length > 0
      ? [
          {
            line: places.caches.map((each) => fromHome(each, home)).join(", "),
            name: "Caches",
            path: places.caches[0] ?? "",
            status: appFiles === "never" ? "Not allowed" : "Allowed",
          },
        ]
      : []),
    ...places.programs.map((path) => ({
      line: fromHome(path, home),
      name: "Installed programs",
      path,
      status: "Read only",
    })),
  ];
  const listed = appFiles === "ask" && !isLinux();
  return (
    <div className="space-y-2" {...settingAnchor("always-open")}>
      <h4 className="text-sm font-medium text-muted-foreground">Always open</h4>
      <p className="text-xs text-muted-foreground">
        Instrument needs these to work, so every chat can use them.
      </p>
      <div className="divide-y overflow-hidden rounded-lg border">
        {rows.map((row) => (
          <PermissionRow
            control={status(row.status)}
            key={row.path}
            line={row.line}
            mark={<FolderMark size="row" path={row.path} />}
            name={row.name}
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
            Programs the agent runs can see the names, sizes and dates of what's
            in Other apps' files, but Instrument asks you before a program opens
            anything there.
          </p>
        ) : null}
        {places.caches.length > 0 ? (
          <p>Your browsers' caches stay closed.</p>
        ) : null}
      </div>
    </div>
  );
}

function PermissionRow({
  control,
  line,
  mark,
  name,
}: {
  control: ReactNode;
  line: string | undefined;
  mark: ReactNode;
  name: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3">
      <span className="flex w-7 shrink-0 justify-center">{mark}</span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-sm">{name}</div>
        {line ? (
          <p className="truncate text-xs text-muted-foreground">{line}</p>
        ) : null}
      </div>
      {control}
    </div>
  );
}

function PlaceRow({
  home,
  onSelect,
  place,
}: {
  home: string;
  onSelect: (level: Level) => void;
  place: Place;
}) {
  const className = "size-6 text-muted-foreground";
  const volumes = useComputerVolumes();
  const details = (() => {
    switch (place.id) {
      case "output": {
        return {
          line: fromHome(place.paths[0] ?? "", home),
          mark: <FolderMark size="row" path={place.paths[0] ?? ""} />,
          name: "Instrument folder",
        };
      }
      case "desktop":
      case "documents":
      case "downloads": {
        return {
          line: undefined,
          mark: <FolderMark size="row" path={place.paths[0] ?? ""} />,
          name: {
            desktop: "Desktop",
            documents: "Documents",
            downloads: "Downloads",
          }[place.id],
        };
      }
      case "icloud": {
        return {
          line: undefined,
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
                  .join(", ") || undefined,
              mark: <HardDriveIcon className={className} />,
              name: "Other drives",
            }
          : {
              line: undefined,
              mark: <HardDriveIcon className={className} />,
              name: "Drives you plug in",
            };
      }
      case "appFiles": {
        return {
          line: osConventions().appFiles,
          mark: <PlaceIcon className={className} place="apps" />,
          name: "Other apps' files",
        };
      }
      case "photos": {
        return {
          line: undefined,
          mark: <ImagesIcon className={className} />,
          name: "Photos library",
        };
      }
      case "mediaLibraries": {
        return {
          line: undefined,
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
                ? `Folders like .ssh ask first; your browsers and ${passwordStore} stay closed`
                : "Folders like .ssh ask first; your browsers stay closed"
              : "Keys, sign-ins and browser cookies",
          mark: <KeyIcon className={className} />,
          name: "Passwords and keys",
        };
      }
      default: {
        place.id satisfies never;
        return { line: undefined, mark: null, name: "" };
      }
    }
  })();
  return (
    <PermissionRow
      control={
        place.id === "output" ? (
          <span className="px-3 text-sm text-muted-foreground">
            Always allowed
          </span>
        ) : (
          <LevelSelect
            label={details.name}
            level={place.level}
            onSelect={onSelect}
          />
        )
      }
      line={details.line}
      mark={details.mark}
      name={details.name}
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
