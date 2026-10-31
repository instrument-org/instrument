import { ArrowsLeftRightIcon } from "@phosphor-icons/react/ArrowsLeftRight";
import { useContext } from "react";

import { Button } from "../ui/button";
import { type MenuComponents } from "../ui/menu-components";
import { WindowContext } from "./context";

/**
 * Convert…, for any file: a new draft with the files picked and the ask
 * started, for the person to finish with the format they want. The agent does
 * the converting, so the app keeps no list of formats or converters. Every
 * place that offers it reads this module.
 */
const CONVERT_LABEL = "Convert…";

/** The start of the ask; the person finishes the sentence. */
export function convertWords(count: number) {
  return count > 1 ? "Convert these to " : "Convert this to ";
}

/**
 * Opens the convert draft for these files; undefined where no draft can open
 * (inside a draft, beside a chat), so callers leave the action out there.
 */
export function useConvertFiles():
  | ((hostPaths: readonly string[]) => void)
  | undefined {
  const askAbout = useContext(WindowContext)?.askAbout;
  if (!askAbout) {
    return undefined;
  }
  return (hostPaths) => {
    askAbout(
      hostPaths.map((path) => ({ kind: "file", path })),
      convertWords(hostPaths.length),
    );
  };
}

/** Convert… as a row of whichever menu it is in. */
export function ConvertMenuItem({
  hostPaths,
  menuComponents,
}: {
  hostPaths: readonly string[];
  menuComponents: MenuComponents;
}) {
  const convert = useConvertFiles();
  if (!convert || hostPaths.length === 0) {
    return null;
  }
  const { Item } = menuComponents;
  return (
    <Item
      onClick={() => {
        convert(hostPaths);
      }}
    >
      <ArrowsLeftRightIcon className="size-4" />
      <span>{CONVERT_LABEL}</span>
    </Item>
  );
}

/** Convert… as a button, for a file the app can't show. */
export function ConvertButton({ hostPath }: { hostPath: string }) {
  const convert = useConvertFiles();
  if (!convert) {
    return null;
  }
  return (
    <Button
      onClick={() => {
        convert([hostPath]);
      }}
      size="sm"
      variant="outline"
    >
      <ArrowsLeftRightIcon className="size-4" />
      {CONVERT_LABEL}
    </Button>
  );
}
