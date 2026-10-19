import { useEffect, useRef, useState } from "react";

const DURATION_MS = 2000;

export function useTimedFlag() {
  const [active, setActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, []);

  const trigger = () => {
    clearTimeout(timerRef.current);
    setActive(true);
    timerRef.current = setTimeout(() => {
      setActive(false);
    }, DURATION_MS);
  };

  return { active, trigger };
}
