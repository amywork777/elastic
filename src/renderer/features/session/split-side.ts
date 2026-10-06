import { createContext, useContext, useState } from "react";

import { useSessions, type SplitSide } from "@renderer/state/sessions";

/** Which side of a split this part of the session pane is drawn in; null when one chat has the pane. */
export const SplitSideContext = createContext<SplitSide | null>(null);
export const useSplitSide = () => useContext(SplitSideContext);

/**
 * Whether a composer here takes the keyboard when it mounts: not in the side that is not focused,
 * which would pull focus (and so the explorer) away from the chat just opened beside it. Decided
 * once, at mount: a side taking focus later (a click in its transcript) must not move the caret.
 */
export function useTakesFocus(): boolean {
  const side = useSplitSide();
  const now = useSessions((state) => side === null || state.split?.focus === side);
  const [atMount] = useState(now);
  return atMount;
}
