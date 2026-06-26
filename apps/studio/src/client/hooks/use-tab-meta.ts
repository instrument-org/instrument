import { tabsAtom } from "@/client/atoms/tabs";
import { useTabId } from "@/client/components/tab-context";
import { setTabMeta } from "@/client/lib/tab-model";
import { type TabIconName } from "@instrument-org/shared/icons";
import { type TaskId } from "@instrument-org/workspace/client";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

/**
 * Lets a route set its tab's icon/title/taskId in the renderer tab model. With
 * one web contents and N per-tab routers, tab metadata can no longer ride the
 * shared document head; routes report it here instead.
 */
export function useTabMeta({
  iconName,
  taskId,
  title,
}: {
  iconName?: TabIconName;
  taskId?: TaskId;
  title?: string;
}) {
  const id = useTabId();
  const setTabs = useSetAtom(tabsAtom);

  useEffect(() => {
    if (!id) {
      return;
    }
    setTabs((model) => setTabMeta(model, { iconName, id, taskId, title }));
  }, [id, iconName, taskId, title, setTabs]);
}
