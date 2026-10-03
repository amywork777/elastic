import appMark from "@renderer/assets/brand/elastic-mark.svg";

/** The mark (scripts/brand-mark.mjs) beside the word, in the app's own sans. */
export function Wordmark() {
  return (
    <span aria-label="elastic" className="app-no-drag flex min-w-0 items-center gap-2" role="img">
      <img alt="" className="size-7 shrink-0 object-contain" src={appMark} />
      <span className="truncate text-[17px] font-medium tracking-tight">elastic</span>
    </span>
  );
}
