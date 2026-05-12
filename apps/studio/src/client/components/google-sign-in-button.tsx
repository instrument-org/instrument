import { Button } from "@/client/components/ui/button";
import { FcGoogle } from "react-icons/fc";

export function GoogleSignInButton({
  className,
  onSignIn,
  onSuccess,
}: {
  className?: string;
  onSignIn: () => Promise<void>;
  onSuccess?: () => void;
}) {
  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await onSignIn();
    onSuccess?.();
  };

  return (
    <form
      className="flex w-full items-center justify-center"
      onSubmit={handleSignIn}
    >
      <Button className={className} type="submit" variant="default">
        <FcGoogle />
        Continue with Google
      </Button>
    </form>
  );
}
