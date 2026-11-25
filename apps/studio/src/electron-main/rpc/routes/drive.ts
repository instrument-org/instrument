import { devOnly } from "@/electron-main/rpc/base";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import {
  answerHeldDialog,
  appMenuRows,
  dismissHeldMenu,
  heldNative,
  type HeldDialog,
  type MenuRow,
  pressKeyIn,
  pressMenuKey,
  pressMenuRow,
} from "@/electron-main/windows/held-native";
import { isDrivenInstance } from "@/electron-main/windows/on-screen";
import { type BrowserWindow } from "electron";
import { z } from "zod";

/**
 * What a script driving this instance cannot reach over CDP: the menus and
 * dialogs the system draws, and the keys the main process hears ahead of the
 * page. Answers only in an instance studio-drive started.
 */
const driven = devOnly.use(({ context, errors, next }) => {
  const window = getCallingWindow(context.webContentsId);
  if (!isDrivenInstance() || !window) {
    throw errors.UNAUTHORIZED({
      message: "Only an instance studio-drive started answers this",
    });
  }
  return next({ context: { window } satisfies { window: BrowserWindow } });
});

const MenuRowSchema: z.ZodType<MenuRow> = z.lazy(() =>
  z.object({
    accelerator: z.string().optional(),
    checked: z.boolean().optional(),
    enabled: z.boolean(),
    label: z.string(),
    submenu: z.array(MenuRowSchema).optional(),
  }),
);

const HeldDialogSchema: z.ZodType<HeldDialog> = z.object({
  buttons: z.array(z.string()),
  detail: z.string().optional(),
  id: z.string(),
  kind: z.enum(["message", "open", "save"]),
  message: z.string(),
});

const held = driven
  .output(
    z.object({
      dialogs: z.array(HeldDialogSchema),
      menu: z.array(MenuRowSchema).nullable(),
    }),
  )
  .handler(() => heldNative());

const menuBar = driven
  .output(z.array(MenuRowSchema))
  .handler(() => appMenuRows());

const pressMenu = driven
  .input(
    z.object({ from: z.enum(["bar", "held"]), labels: z.array(z.string()) }),
  )
  .output(z.object({ pressed: z.boolean() }))
  .handler(({ context, input }) => ({
    pressed: pressMenuRow(input.from, input.labels, context.window),
  }));

const dismissMenu = driven.handler(() => {
  dismissHeldMenu();
});

const answerDialog = driven
  .input(
    z.object({
      button: z.number().optional(),
      cancel: z.boolean().optional(),
      checked: z.boolean().optional(),
      id: z.string().optional(),
      paths: z.array(z.string()).optional(),
    }),
  )
  .output(z.object({ answered: HeldDialogSchema.nullable() }))
  .handler(({ input }) => ({
    answered:
      answerHeldDialog(
        input.paths
          ? { paths: input.paths }
          : input.button === undefined || input.cancel
            ? "cancel"
            : { button: input.button, checked: input.checked ?? false },
        input.id,
      ) ?? null,
  }));

const pressKey = driven
  .input(
    z.object({
      /** The page holding the keyboard, when one does. */
      guestId: z.number().optional(),
      keyCode: z.string(),
      modifiers: z.array(z.enum(["alt", "control", "meta", "shift"])),
    }),
  )
  .output(z.object({ taken: z.boolean() }))
  .handler(({ context, input }) => ({
    taken: pressKeyIn(context.window, input.guestId, input),
  }));

const menuKey = driven
  .input(
    z.object({
      alt: z.boolean(),
      code: z.string(),
      control: z.boolean(),
      guestId: z.number().optional(),
      key: z.string(),
      meta: z.boolean(),
      shift: z.boolean(),
    }),
  )
  .output(z.object({ item: z.string().nullable() }))
  .handler(({ context, input }) => ({
    item: pressMenuKey(context.window, input.guestId, input) ?? null,
  }));

export const drive = {
  answerDialog,
  dismissMenu,
  held,
  menuBar,
  menuKey,
  pressKey,
  pressMenu,
};
