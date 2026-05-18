import { useEffect, useRef, useState } from "react";

interface UseDelayedBusyStateOptions {
  delayMs?: number;
  minVisibleMs?: number;
}

export function useDelayedBusyState(
  active: boolean,
  { delayMs = 200, minVisibleMs = 160 }: UseDelayedBusyStateOptions = {}
): boolean {
  const [visible, setVisible] = useState(false);
  const visibleSinceRef = useRef(0);
  const showTimeoutRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (showTimeoutRef.current !== null) {
        window.clearTimeout(showTimeoutRef.current);
      }
      if (hideTimeoutRef.current !== null) {
        window.clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (showTimeoutRef.current !== null) {
      window.clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }

    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    if (active) {
      if (visible) return;

      showTimeoutRef.current = window.setTimeout(() => {
        visibleSinceRef.current = Date.now();
        setVisible(true);
        showTimeoutRef.current = null;
      }, delayMs);
      return;
    }

    if (!visible) return;

    const elapsed = Date.now() - visibleSinceRef.current;
    const remainingVisibleMs = Math.max(0, minVisibleMs - elapsed);

    hideTimeoutRef.current = window.setTimeout(() => {
      setVisible(false);
      hideTimeoutRef.current = null;
    }, remainingVisibleMs);
  }, [active, delayMs, minVisibleMs, visible]);

  return visible;
}
