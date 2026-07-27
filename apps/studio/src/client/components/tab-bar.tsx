import { Tab } from "@/client/components/tab";
import { useSelectedTabId } from "@/client/hooks/use-selected-tab-id";
import { useTabs } from "@/client/hooks/use-tabs";
import { useTabsController } from "@/client/hooks/use-tabs-controller";
import { NEW_TAB_PATH } from "@/client/lib/tab-actions";
import { PlusIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, Reorder } from "motion/react";

export default function TabBar() {
  const { addTab, closeTab, reorderTabs, selectTab } = useTabsController();
  const selectedTabId = useSelectedTabId();
  const tabs = useTabs();

  return (
    <div className="flex h-full min-w-0 flex-1 flex-row items-stretch overflow-hidden px-3 [-webkit-app-region:drag]">
      <Reorder.Group
        as="ul"
        axis="x"
        className="flex min-w-0 flex-1 flex-nowrap items-stretch justify-start gap-1 py-1"
        onReorder={(values) => {
          reorderTabs({ ids: values.map((tab) => tab.id) });
        }}
        values={tabs}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {tabs.map((item, index) => (
            <Tab
              isSelected={selectedTabId === item.id}
              item={item}
              key={item.id}
              onClick={() => {
                selectTab({ id: item.id });
              }}
              onRemove={() => {
                closeTab({ id: item.id });
              }}
              showSeparator={tabs[index + 1]?.id !== selectedTabId}
            />
          ))}
        </AnimatePresence>
        <li className="flex shrink-0 items-center self-stretch pl-0.5">
          <motion.button
            className="group inline-flex shrink-0 items-center justify-center rounded-xl px-3 py-2 [-webkit-app-region:no-drag] hover:bg-muted/60"
            onClick={() => {
              addTab({ pathname: NEW_TAB_PATH });
            }}
            type="button"
            whileTap={{ scale: 0.97 }}
          >
            <PlusIcon className="block size-4 shrink-0 text-muted-foreground opacity-90 group-hover:text-foreground group-hover:opacity-100" />
          </motion.button>
        </li>
      </Reorder.Group>
    </div>
  );
}
