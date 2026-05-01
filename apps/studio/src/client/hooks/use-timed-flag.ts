import { useEffect, useRef, useState } from "react";

export function useTimedFlag(duration = 2000) {
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
    }, duration);
  };

  return { active, trigger };
}
