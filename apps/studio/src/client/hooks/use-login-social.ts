import { captureClientEvent } from "@/client/lib/capture-client-event";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";

export function useLoginSocial() {
  const { mutateAsync: loginSocial, ...rest } = useMutation(
    rpcClient.auth.signInSocial.mutationOptions(),
  );

  const login = async () => {
    captureClientEvent("auth.login_started");
    await loginSocial({});
  };

  return { login, ...rest };
}
