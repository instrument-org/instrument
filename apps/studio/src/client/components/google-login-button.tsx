import { Button } from "@/client/components/ui/button";
import { FcGoogle } from "react-icons/fc";

export function GoogleLoginButton({
  className,
  onLogin,
  onSuccess,
}: {
  className?: string;
  onLogin: () => Promise<void>;
  onSuccess?: () => void;
}) {
  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await onLogin();
    onSuccess?.();
  };

  return (
    <form
      className="flex w-full items-center justify-center"
      onSubmit={handleLogin}
    >
      <Button className={className} type="submit" variant="default">
        <FcGoogle />
        Continue with Google
      </Button>
    </form>
  );
}
