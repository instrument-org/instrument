import {
  rpcClient,
} from "@/client/rpc/client";

import {
  captureClientEvent,
} from "./capture-client-event";

export async function logOut() {
  await rpcClient.auth.signOut.call();
  captureClientEvent("auth.logged_out");
}
