import {
  platformApiQueryClient,
  platformApiRpcClient,
} from "@/electron-main/platform-api/client";
import { base } from "@/electron-main/rpc/base";

const get = base.handler(async () => {
  return platformApiQueryClient.fetchQuery(
    platformApiRpcClient.plans.get.queryOptions(),
  );
});

export const plans = {
  get,
};
