import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/client/components/ui/avatar";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { useHasLifetime } from "@/client/hooks/use-entitlements";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { getInitials } from "@/client/lib/get-initials";
import { logOut } from "@/client/lib/log-out";

import { FoundingUserLabel } from "./founding-user-label";

export function UserInfoCard() {
  const { data: user } = useLiveUser();
  const hasLifetime = useHasLifetime();

  if (!user?.id) {
    return null;
  }

  return (
    <Card className="p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-10 shrink-0">
            <AvatarImage alt={user.name} src={user.image || undefined} />
            <AvatarFallback className="text-sm font-medium">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-sm font-semibold">{user.name}</h4>
              {hasLifetime && <FoundingUserLabel />}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
        </div>
        <Button
          className="shrink-0 font-medium"
          onClick={() => {
            void logOut();
          }}
          size="sm"
        >
          Log out
        </Button>
      </div>
    </Card>
  );
}
