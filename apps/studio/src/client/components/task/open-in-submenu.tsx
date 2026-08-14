import type {
  SupportedEditor,
  SupportedEditorId,
} from "@/shared/schemas/editors";
import type { TaskId } from "@instrument-org/workspace/client";

import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { type MenuComponents } from "@/client/components/ui/menu-components";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { OpenTaskInTypeSchema } from "@/shared/schemas/editors";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { TerminalWindowIcon } from "@phosphor-icons/react/TerminalWindow";
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
  "text-dev-700 focus:bg-dev-500/10 focus:text-dev-700 data-[state=open]:bg-dev-500/10 data-[state=open]:text-dev-700 dark:text-dev-300 dark:focus:text-dev-300 dark:data-[state=open]:text-dev-300 [&_svg]:text-dev-700! dark:[&_svg]:text-dev-300!";

const devSubItemClass =
  "text-dev-700 focus:bg-dev-500/10 focus:text-dev-700 dark:text-dev-300 dark:focus:text-dev-300 [&_svg]:text-dev-700! dark:[&_svg]:text-dev-300!";

export function TaskOpenInSubmenu({
  id,
  menuComponents,
}: {
  id: TaskId;
  menuComponents: MenuComponents;
}) {
  const { Item, Separator, Sub, SubContent, SubTrigger } = menuComponents;

  const { data: supportedEditors = [] } = useQuery<SupportedEditor[]>(
    rpcClient.utils.getSupportedEditors.queryOptions(),
  );

  const openTaskInMutation = useMutation(
    rpcClient.utils.openTaskIn.mutationOptions({
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
    <Sub>
      <SubTrigger className={devSubTriggerClass}>
        <FolderOpenIcon className="size-4" />
        Open in
      </SubTrigger>
      <SubContent className="min-w-48">
        <Item
          className={devSubItemClass}
          onClick={() => {
            openTaskInMutation.mutate({
              id,
              type: "show-in-folder",
            });
          }}
        >
          <RevealInFolderIcon className="size-4" />
          {getRevealInFolderLabel()}
        </Item>

        {availableEditors.length > 0 && (
          <>
            <Separator />
            {availableEditors.map((editor) => {
              const Icon = EDITOR_ICON_MAP[editor.id];

              return (
                <Item
                  className={devSubItemClass}
                  key={editor.id}
                  onClick={() => {
                    openTaskInMutation.mutate({
                      id,
                      type: OpenTaskInTypeSchema.parse(editor.id),
                    });
                  }}
                >
                  <Icon className="size-4" />
                  {editor.name}
                </Item>
              );
            })}
          </>
        )}

        {availableTerminals.length > 0 && (
          <>
            <Separator />
            {availableTerminals.map((editor) => {
              const Icon = EDITOR_ICON_MAP[editor.id];

              return (
                <Item
                  className={devSubItemClass}
                  key={editor.id}
                  onClick={() => {
                    openTaskInMutation.mutate({
                      id,
                      type: OpenTaskInTypeSchema.parse(editor.id),
                    });
                  }}
                >
                  <Icon className="size-4" />
                  {editor.name}
                </Item>
              );
            })}
          </>
        )}
      </SubContent>
    </Sub>
  );
}
