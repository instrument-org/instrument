import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { useQuery } from "@tanstack/react-query";

/**
 * A Mac app's own icon, by the name a permission card or Settings shows it
 * by; the app glyph while it loads, off macOS, or where no app goes by it.
 */
export function MacAppIcon({ app }: { app: string }) {
  const icon = useQuery({
    ...rpcClient.mac.appIcon.queryOptions({ input: { app } }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return icon.data?.url ? (
    <img alt="" className="size-6" draggable={false} src={icon.data.url} />
  ) : (
    <AppWindowIcon className="size-6 text-muted-foreground" />
  );
}
