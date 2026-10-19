import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { logOut } from "@/client/lib/log-out";
import { APP_NAME } from "@instrument-org/shared";
import { type ComponentProps } from "react";

/**
 * Log out of the Instrument account, asking first: it ends the plan's models
 * for every chat on them, and the button sits where a pass through Settings
 * can catch it.
 */
export function LogOutButton(
  props: Omit<ComponentProps<typeof Button>, "children" | "onClick">,
) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button {...props}>Log out</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Log out of {APP_NAME}?</AlertDialogTitle>
          <AlertDialogDescription>
            Chats on {APP_NAME}&apos;s models will need another model until you
            log in again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void logOut();
            }}
          >
            Log out
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
