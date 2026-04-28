import type {
  SupportedEditor,
  SupportedEditorId,
} from "@/shared/schemas/editors";
import type { WorkspaceAppProject } from "@instrument-org/workspace/client";

import { getRevealInFolderLabel, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { OpenAppInTypeSchema } from "@/shared/schemas/editors";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FolderOpenIcon, Terminal } from "lucide-react";
import { toast } from "sonner";

import {
  Alacritty,
  CMD,
  Cursor,
  ITerm,
  MacOSTerminal,
  VSCode,
} from "../service-icons";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../ui/dropdown-menu";

const EDITOR_ICON_MAP: Record<
  SupportedEditorId,
  React.ComponentType<{ className?: string }>
> = {
  alacritty: Alacritty,
  cmd: CMD,
  cursor: Cursor,
  iterm: ITerm,
  powershell: Terminal,
  terminal: MacOSTerminal,
  vscode: VSCode,
};

const devSubTriggerClass =
  "text-warning-foreground focus:bg-warning/10 focus:text-warning-foreground data-[state=open]:bg-warning/10 data-[state=open]:text-warning-foreground [&_svg:not([class*='text-'])]:text-warning-foreground";

const devSubItemClass =
  "text-warning-foreground focus:bg-warning/10 focus:text-warning-foreground [&_svg]:text-warning-foreground";

export function ProjectOpenInSubmenu({
  project,
}: {
  project: WorkspaceAppProject;
}) {
  const { data: supportedEditors = [] } = useQuery<SupportedEditor[]>(
    rpcClient.utils.getSupportedEditors.queryOptions(),
  );

  const openAppInMutation = useMutation(
    rpcClient.utils.openAppIn.mutationOptions({
      onError: (error) => {
        toast.error("Failed to open in app", {
          description: error.message,
        });
      },
    }),
  );

  const availableEditors = supportedEditors.filter(
    (editor) => editor.available && ["cursor", "vscode"].includes(editor.id),
  );

  const availableTerminals = supportedEditors.filter(
    (editor) =>
      editor.available &&
      ["alacritty", "iterm", "terminal"].includes(editor.id),
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={devSubTriggerClass}>
        <FolderOpenIcon className="size-4" />
        Open in
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-48">
        <DropdownMenuItem
          className={devSubItemClass}
          onClick={() => {
            void openAppInMutation.mutateAsync({
              subdomain: project.subdomain,
              type: "show-in-folder",
            });
          }}
        >
          {isMacOS() ? (
            <svg
              className="size-4"
              height="24"
              viewBox="0 0 24 24"
              width="24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M21.001 3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm-1 2h-8.465Q10.5 7.966 10.5 13h3a17 17 0 0 0-.107 2.877c1.226-.211 2.704-.777 4.027-1.71l1.135 1.665c-1.642 1.095-3.303 1.779-4.976 2.043q.078.555.184 1.125H20zM6.556 14.168l-1.11 1.664C7.603 17.27 9.793 18 12.001 18v-2c-1.792 0-3.602-.603-5.445-1.832M17 7a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1M7 7c-.552 0-1 .452-1 1v1a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1"
                fill="currentColor"
              />
            </svg>
          ) : (
            <FolderOpenIcon className="size-4" />
          )}
          {getRevealInFolderLabel()}
        </DropdownMenuItem>

        {availableEditors.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {availableEditors.map((editor) => {
              const Icon = EDITOR_ICON_MAP[editor.id];

              return (
                <DropdownMenuItem
                  className={devSubItemClass}
                  key={editor.id}
                  onClick={() => {
                    void openAppInMutation.mutateAsync({
                      subdomain: project.subdomain,
                      type: OpenAppInTypeSchema.parse(editor.id),
                    });
                  }}
                >
                  <Icon className="size-4" />
                  {editor.name}
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        {availableTerminals.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {availableTerminals.map((editor) => {
              const Icon = EDITOR_ICON_MAP[editor.id];

              return (
                <DropdownMenuItem
                  className={devSubItemClass}
                  key={editor.id}
                  onClick={() => {
                    void openAppInMutation.mutateAsync({
                      subdomain: project.subdomain,
                      type: OpenAppInTypeSchema.parse(editor.id),
                    });
                  }}
                >
                  <Icon className="size-4" />
                  {editor.name}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
