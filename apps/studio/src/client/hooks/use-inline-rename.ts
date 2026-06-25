import type React from "react";

import { useEffect, useRef, useState } from "react";

export type InlineRenameInputProps = ReturnType<
  typeof useInlineRename
>["inputProps"];

// Shared inline-rename state machine for sidebar rows (tasks, projects). The row
// renders the current value normally and swaps to an <Input> while `isEditing`.
// Enter / blur saves, Escape cancels. After a successful save we wait briefly for
// the live query to push the new value so the row doesn't flicker old → new.
export function useInlineRename({
  onSave,
  value,
}: {
  onSave: (next: string) => Promise<void>;
  value: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isEditing && editValue !== value) {
    setEditValue(value);
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const start = () => {
    setEditValue(value);
    setIsEditing(true);
  };

  const cancel = () => {
    setIsEditing(false);
    setEditValue(value);
  };

  const save = async () => {
    const next = editValue.trim();
    if (!next) {
      return;
    }

    if (next === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(next);
      // wait for client update to avoid flicker
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
      setIsEditing(false);
    } catch {
      setEditValue(value);
    } finally {
      setIsSaving(false);
    }
  };

  return {
    inputProps: {
      disabled: isSaving,
      onBlur: () => {
        void save();
      },
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditValue(e.target.value);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      },
      ref: inputRef,
      value: editValue,
    },
    isEditing,
    start,
  };
}
