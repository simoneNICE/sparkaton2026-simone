import { useEffect, useRef } from "react";

// Runs `effect` `delayMs` after the last change to `deps`, collapsing a burst
// of rapid changes (e.g. dragging a slider) into a single call. Pending calls
// are cancelled on unmount and whenever a new change arrives.
export function useDebouncedEffect(
  effect: () => void,
  deps: React.DependencyList,
  delayMs: number,
) {
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    const timer = setTimeout(() => effectRef.current(), delayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
