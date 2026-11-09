import type React from "react";

import { useEffect, useRef, useState } from "react";

/**
 * An inline field for renaming something, which closes once `onSave` is
 * done; `onSave` has the new name showing by then, so the old one never
 * shows again between the two.
 */
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
    if (await succeeds(() => onSave(next))) {
      setIsEditing(false);
    } else {
      setEditValue(value);
    }
    setIsSaving(false);
  };

  return {
    cancel,
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

async function succeeds(run: () => Promise<void>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
}
