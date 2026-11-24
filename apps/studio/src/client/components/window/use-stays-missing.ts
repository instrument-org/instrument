import { useEffect, useState } from "react";

/** How long a chat with no record may still be on its way to having one. */
const MISSING_GRACE_MS = 5000;

/**
 * Whether a chat has no record and none is on its way: it has had none for
 * the whole grace, or had one, which went. The grace is for a chat still
 * being made.
 */
export function useStaysMissing({
  isMissing,
  isThere,
}: {
  isMissing: boolean;
  isThere: boolean;
}): boolean {
  const [isGraceOver, setIsGraceOver] = useState(false);
  const [wasThere, setWasThere] = useState(isThere);
  if (isThere && !wasThere) {
    setWasThere(true);
  }
  useEffect(() => {
    if (!isMissing) {
      return;
    }
    const timer = setTimeout(() => {
      setIsGraceOver(true);
    }, MISSING_GRACE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isMissing]);
  return isMissing && (wasThere || isGraceOver);
}
