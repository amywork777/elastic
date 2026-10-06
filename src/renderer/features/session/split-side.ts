import { createContext, useContext, useState } from "react";

import { useSessions, type SplitSide } from "@renderer/state/sessions";

/** Which side of a split this part of the session pane is drawn in; null when one chat has the pane. */
export const SplitSideContext = createContext<SplitSide | null>(null);
export const useSplitSide = () => useContext(SplitSideContext);

/**
 * Whether a composer here takes the keyboard on its own: not in the side that is not focused,
 * which would pull focus (and so the explorer) away from the chat just opened beside it. Yes at
 * mount only if its side is focused, and once its side has lost focus, never again: a side taking
 * focus back (a click in its transcript) must not move the caret, and a composer that mounted
 * while it was the only chat must not reclaim the keyboard when the split opens beside it.
 */
export function useTakesFocus(): boolean {
  const side = useSplitSide();
  const now = useSessions((state) => side === null || state.split === null || state.split.focus === side);
  const [takes, setTakes] = useState(now);
  if (takes && !now) setTakes(false);
  return takes && now;
}
