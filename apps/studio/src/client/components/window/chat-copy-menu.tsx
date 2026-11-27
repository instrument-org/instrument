import { CopyIcon } from "@phosphor-icons/react/Copy";
import { type MenuComponents } from "@/client/components/ui/menu-components";
import { useTabDeveloperMode } from "@/client/hooks/use-developer-mode";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";

import { type Chat } from "./chats";

/** Runs one way of copying a chat, saying in a toast that it worked or that it didn't. */
export async function copying(
  copy: () => Promise<unknown>,
  { done, failed }: { done: string; failed: string },
) {
  const [error] = await safe(copy());
  if (error) {
    toast.error(failed, { cause: error });
    return;
  }
  toast.success(done);
}

/** Puts a path the main process answers with on the clipboard. */
export async function writePath(path: () => Promise<string>) {
  await navigator.clipboard.writeText(await path());
}

/**
 * A chat's Copy submenu, the same in every menu of a chat: the path of its
 * work folder, where its scratch is; what another agent needs to pick up
 * from it; and, in developer
 * mode, where its records are and which build and computer it ran on, in the
 * developer color. Drawn with the parts of whichever menu it sits in.
 */
export function ChatCopyMenu({
  chat,
  menu,
}: {
  chat: Chat;
  menu: MenuComponents;
}) {
  const { Item, Separator, Sub, SubContent, SubTrigger } = menu;
  const isDeveloperMode = useTabDeveloperMode();
  const id = chat.id;
  return (
    <Sub>
      <SubTrigger>
        <CopyIcon className="size-4" />
        Copy
      </SubTrigger>
      <SubContent>
        <Item
          onSelect={() => {
            void copying(
              () =>
                writePath(() =>
                  rpcClient.utils.chatWorkFolderPath.call({ id }),
                ),
              {
                done: "Copied the work folder's path",
                failed: "Couldn't copy the work folder's path",
              },
            );
          }}
        >
          Work Folder Path
        </Item>
        <Separator />
        <Item
          onSelect={() => {
            void copying(() => rpcClient.chatLocation.forAgent.call({ id }), {
              done: "Copied for an agent",
              failed: "Couldn't copy it for an agent",
            });
          }}
        >
          For an Agent
        </Item>
        {isDeveloperMode && (
          <>
            <Separator />
            <Item
              onSelect={() => {
                void copying(
                  () =>
                    rpcClient.chatLocation.developerDetails.call({
                      id,
                      sessionId: chat.sessionId,
                    }),
                  {
                    done: "Copied developer details",
                    failed: "Couldn't copy developer details",
                  },
                );
              }}
              variant="developer"
            >
              Developer Details
            </Item>
          </>
        )}
      </SubContent>
    </Sub>
  );
}
