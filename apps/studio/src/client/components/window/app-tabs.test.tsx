import { NEW_TAB_HREF } from "@/client/atoms/window";
import { TabIdSchema } from "@/shared/tabs";
import { describe, expect, it } from "vitest";

import { INBOX_HREF, withoutNewTabPage } from "./app-tabs";

describe("withoutNewTabPage", () => {
  it("sends a tab on the new-tab page, open or closed, to the inbox", () => {
    const tab = (id: string, pathname: string) => ({
      history: { entries: ["/apps", pathname], index: 1 },
      id: TabIdSchema.parse(id),
      pathname,
    });
    const model = withoutNewTabPage({
      recentlyClosed: [tab("closed", NEW_TAB_HREF)],
      selectedId: TabIdSchema.parse("open"),
      tabs: [tab("open", NEW_TAB_HREF), tab("apps", "/apps")],
    });
    expect(model.tabs.map((entry) => entry.pathname)).toEqual([
      INBOX_HREF,
      "/apps",
    ]);
    expect(model.recentlyClosed[0]?.history?.entries).toEqual([
      "/apps",
      INBOX_HREF,
    ]);
  });
});
