import { useEffect, useState } from "react";

import { Spinner } from "@renderer/components/ui/spinner";

/** How long a start takes before the view says why it may be slow. */
export const SLOW_START_MS = 8_000;

/**
 * What a plugin's tab or page shows while its server starts. A first start often downloads the
 * plugin's tools (text-to-cad fetches cadgen through uvx), which takes minutes; past a few seconds
 * the view says so, so a slow start does not look like a stuck one.
 */
export function PluginStarting({ name }: { name: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-sm">
      <span className="flex items-center gap-2"><Spinner className="size-4" /> Starting {name}…</span>
      {slow ? <span className="max-w-sm text-xs" role="note">The first start can take a few minutes while it downloads what it needs.</span> : null}
    </div>
  );
}
