import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { useState } from "react";
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
  const [disabled, setDisabled] = useState(false);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDisabled(true);
    setTimeout(() => {
      setDisabled(false);
    }, 5000);
    await onLogin();
    onSuccess?.();
  };

  return (
    <form
      className="flex w-full items-center justify-center"
      onSubmit={handleLogin}
    >
      <Button
        className={className}
        disabled={disabled}
        type="submit"
        variant="default"
      >
        {disabled ? <Spinner /> : <FcGoogle />}
        Continue with Google
      </Button>
    </form>
  );
}
