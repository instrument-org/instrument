import type {
  SupportedEditor,
  SupportedEditorId,
} from "@/shared/schemas/editors";
import type { ProjectSubdomain } from "@instrument-org/workspace/client";

import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { OpenAppInTypeSchema } from "@/shared/schemas/editors";
import { FolderOpenIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  powershell: TerminalWindowIcon,
  terminal: MacOSTerminal,
  vscode: VSCode,
};

const devSubTriggerClass =
  "text-blue-700 focus:bg-blue-500/10 focus:text-blue-700 data-[state=open]:bg-blue-500/10 data-[state=open]:text-blue-700 dark:text-blue-300 dark:focus:text-blue-300 dark:data-[state=open]:text-blue-300 [&_svg]:text-blue-700! dark:[&_svg]:text-blue-300!";

const devSubItemClass =
  "text-blue-700 focus:bg-blue-500/10 focus:text-blue-700 dark:text-blue-300 dark:focus:text-blue-300 [&_svg]:text-blue-700! dark:[&_svg]:text-blue-300!";

export function ProjectOpenInSubmenu({
  subdomain,
}: {
  subdomain: ProjectSubdomain;
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
              subdomain,
              type: "show-in-folder",
            });
          }}
        >
          <RevealInFolderIcon className="size-4" />
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
                      subdomain,
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
                      subdomain,
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
