import LoadingIcon from "@workbench/ui/loading-icon";

/**
 * The mark beside the word, in the app's own sans. Inside the app the mark is the band and
 * its pegs alone, in the text colour (the loading glyph's still pose), not the Dock icon's
 * tile, so it sits on the sidebar in either theme.
 */
export function Wordmark() {
  return (
    <span aria-label="elastic" className="app-no-drag flex min-w-0 items-center gap-2" role="img">
      <LoadingIcon active={false} className="text-foreground" size={26} />
      <span className="truncate text-[17px] font-medium tracking-tight">elastic</span>
    </span>
  );
}
