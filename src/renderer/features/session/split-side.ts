import { createContext, useContext } from "react";

import type { SplitSide } from "@renderer/state/sessions";

/** Which side of a split this part of the session pane is drawn in; null when one chat has the pane. */
export const SplitSideContext = createContext<SplitSide | null>(null);
export const useSplitSide = () => useContext(SplitSideContext);
