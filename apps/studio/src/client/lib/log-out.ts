import { rpcClient } from "@/client/rpc/client";

export async function logOut() {
  await rpcClient.auth.signOut.call();
}
