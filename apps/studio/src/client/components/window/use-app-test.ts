import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";

/**
 * Tests an app's connection again, as its Try again does wherever it is
 * offered: a toast says what went wrong when it still does not connect.
 */
export function useAppTest(name: string) {
  return useMutation(
    rpcClient.apps.test.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't test ${name}`, { cause: error });
      },
      onSuccess: (report) => {
        if (!report.passed) {
          const failure = report.checks.find(
            (check) => check.status === "fail",
          );
          toast.error(`Couldn't connect ${name}`, { cause: failure?.detail });
        }
      },
    }),
  );
}
