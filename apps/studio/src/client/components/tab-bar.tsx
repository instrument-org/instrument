import { Tab } from "@/client/components/tab";
import { useSelectedTabId } from "@/client/hooks/use-selected-tab-id";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { useTabs } from "@/client/hooks/use-tabs";
import { Plus } from "lucide-react";
import { AnimatePresence, motion, Reorder } from "motion/react";

export default function TabBar() {
  const { addTab, closeTab, reorderTabs, selectTab } = useTabActions();
  const selectedTabId = useSelectedTabId();
  const allTabs = useTabs();
  const tabs = allTabs.filter((tab) => !tab.tabBarHidden);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-row items-stretch overflow-hidden px-3">
      <Reorder.Group
        as="ul"
        axis="x"
        className="flex min-w-0 flex-1 flex-nowrap items-stretch justify-start gap-1 py-1 [-webkit-app-region:drag]"
        onReorder={(values) => {
          // Extract only the IDs of non-pinned tabs for reordering
          const nonPinnedTabIds = values
            .filter((tab) => !tab.pinned)
            .map((tab) => tab.id);

          if (nonPinnedTabIds.length > 0) {
            void reorderTabs({ tabIds: nonPinnedTabIds });
          }
        }}
        values={tabs}
      >
        <AnimatePresence initial={false}>
          {tabs.map((item) => (
            <Tab
              isSelected={selectedTabId === item.id}
              item={item}
              key={item.id}
              onClick={() => {
                void selectTab({ id: item.id });
              }}
              onRemove={() => {
                void closeTab({ id: item.id });
              }}
              showSeparator
            />
          ))}
        </AnimatePresence>
        <li className="flex shrink-0 items-center self-stretch pl-0.5">
          <motion.button
            className="group inline-flex shrink-0 items-center justify-center rounded-xl px-3 py-2 transition-colors [-webkit-app-region:no-drag] hover:bg-muted/60"
            onClick={() => {
              void addTab({ to: "/new-tab" });
            }}
            type="button"
            whileTap={{ scale: 0.97 }}
          >
            <Plus className="block size-4 shrink-0 text-muted-foreground opacity-90 transition-colors group-hover:text-foreground group-hover:opacity-100" />
          </motion.button>
        </li>
      </Reorder.Group>
    </div>
  );
}
