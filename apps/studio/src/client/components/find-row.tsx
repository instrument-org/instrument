import { Button } from "@/client/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";
import { type RefObject } from "react";

/**
 * The app's find-in-something control: a field with the match readout at its
 * end, then previous, next and close. Shared by the browser's find card and
 * the document viewers' find popover so the two read and behave identically;
 * each host owns the card the row sits in and what it searches.
 *
 * `activeMatch` is one-based to match how the count reads on screen. Hosts that
 * track a zero-based index add one rather than this offsetting for them, so the
 * two numbers in `2 of 7` always come from the same base. `matchCount` is null
 * while the host has not counted yet, which shows no readout rather than "No
 * matches" for the beat between a keystroke and its count.
 */
export function FindRow({
  activeMatch,
  inputRef,
  matchCount,
  onClose,
  onNextMatch,
  onPreviousMatch,
  onQueryChange,
  placeholder,
  query,
}: {
  activeMatch: number;
  inputRef?: RefObject<HTMLInputElement | null>;
  matchCount: null | number;
  onClose: () => void;
  onNextMatch: () => void;
  onPreviousMatch: () => void;
  onQueryChange: (query: string) => void;
  placeholder: string;
  query: string;
}) {
  const readout =
    query === "" || matchCount === null
      ? ""
      : matchCount === 0
        ? "No matches"
        : `${activeMatch} of ${matchCount}`;
  const canStep = Boolean(matchCount);
  return (
    <div className="flex items-center gap-1">
      <InputGroup className="h-8 rounded-lg border border-input from-transparent to-transparent shadow-none dark:bg-transparent">
        <InputGroupAddon>
          <MagnifyingGlassIcon />
        </InputGroupAddon>
        <InputGroupInput
          className="h-full bg-none dark:border-0"
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) {
                onPreviousMatch();
              } else {
                onNextMatch();
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder={placeholder}
          ref={inputRef}
          spellCheck={false}
          value={query}
        />
        {readout && (
          <InputGroupAddon
            align="inline-end"
            className="text-xs font-normal tabular-nums"
          >
            <span aria-live="polite">{readout}</span>
          </InputGroupAddon>
        )}
      </InputGroup>
      <Button
        aria-label="Previous match"
        disabled={!canStep}
        onClick={onPreviousMatch}
        size="icon-sm"
        variant="ghost"
      >
        <CaretUpIcon className="size-4" />
      </Button>
      <Button
        aria-label="Next match"
        disabled={!canStep}
        onClick={onNextMatch}
        size="icon-sm"
        variant="ghost"
      >
        <CaretDownIcon className="size-4" />
      </Button>
      <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <Button
        aria-label="Close find"
        onClick={onClose}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}
