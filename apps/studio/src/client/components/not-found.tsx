import { Button } from "@/client/components/ui/button";
import { useTabId } from "@/client/hooks/use-active-tab";
import { useTabsController } from "@/client/hooks/use-tabs-controller";
import { useRouter } from "@tanstack/react-router";

export function NotFoundRouteComponent() {
  const router = useRouter();
  const pathname = router.state.location.pathname;

  return <NotFoundComponent message={`Could not find page: ${pathname}`} />;
}

function NotFoundComponent({
  message,
  title = "Not Found",
}: {
  message?: string;
  title?: string;
}) {
  const tabId = useTabId();
  const { closeTab } = useTabsController();

  const handleClose = () => {
    closeTab({ id: tabId });
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center space-y-4 p-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-muted-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Button className="mt-4" onClick={handleClose} variant="outline">
          Close tab
        </Button>
      </div>
    </div>
  );
}
