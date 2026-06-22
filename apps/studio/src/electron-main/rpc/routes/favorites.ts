import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { getFavoritesStore } from "@/electron-main/stores/favorites";
import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { TaskIdSchema } from "@instrument-org/workspace/electron";
import {
  type TaskId,
  workspacePublisher,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

const add = base
  .input(
    z.object({
      id: TaskIdSchema,
    }),
  )
  .output(z.void())
  .handler(({ context, input }) => {
    const favoritesStore = getFavoritesStore();
    const favorites = favoritesStore.get("favorites");
    if (!favorites.includes(input.id)) {
      const updatedFavorites = [...favorites, input.id];
      favoritesStore.set("favorites", updatedFavorites);
    }
    context.workspaceConfig.captureEvent("favorite.added");
  });

const remove = base
  .input(
    z.object({
      id: TaskIdSchema,
    }),
  )
  .output(z.void())
  .handler(({ context, input }) => {
    const favoritesStore = getFavoritesStore();
    const favorites = favoritesStore.get("favorites");
    const updatedFavorites = favorites.filter((app) => app !== input.id);
    favoritesStore.set("favorites", updatedFavorites);
    context.workspaceConfig.captureEvent("favorite.removed");
  });

const live = {
  listTaskIds: base
    .output(eventIterator(TaskIdSchema.array()))
    .handler(async function* ({ signal }) {
      const favoritesStore = getFavoritesStore();

      yield favoritesStore.get("favorites");

      const favoritesUpdated = publisher.subscribe("favorites.updated", {
        signal,
      });
      const taskRemoved = workspacePublisher.subscribe("task.removed", {
        signal,
      });

      for await (const _payload of mergeGenerators([
        favoritesUpdated,
        taskRemoved,
      ])) {
        yield favoritesStore.get("favorites");
      }
    }),
  listTasks: base.handler(async function* ({ context, signal }) {
    const favoritesStore = getFavoritesStore();

    const fetchAndCleanFavorites = async (ids: TaskId[]) => {
      const results = await call(
        workspaceRouter.task.byIds,
        { ids },
        { context, signal },
      );

      const favoriteTasksThatExist = results
        .filter((r) => r.ok)
        .map((r) => r.data);

      if (favoriteTasksThatExist.length !== ids.length) {
        favoritesStore.set(
          "favorites",
          favoriteTasksThatExist.map((p) => p.id),
        );
      }

      return favoriteTasksThatExist.toSorted(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );
    };

    const favorites = favoritesStore.get("favorites");
    yield await fetchAndCleanFavorites(favorites);

    const taskUpdates = workspacePublisher.subscribe("task.updated", {
      signal,
    });
    const taskRemoved = workspacePublisher.subscribe("task.removed", {
      signal,
    });
    const favoritesUpdated = publisher.subscribe("favorites.updated", {
      signal,
    });

    for await (const _payload of mergeGenerators([
      taskUpdates,
      taskRemoved,
      favoritesUpdated,
    ])) {
      const favoritesNext = favoritesStore.get("favorites");
      yield await fetchAndCleanFavorites(favoritesNext);
    }
  }),
};

export const favorites = {
  add,
  live,
  remove,
};
