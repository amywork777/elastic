import { TooltipHint } from "@workbench/ui/primitives/tooltip";
import LoadingIcon from "@workbench/ui/loading-icon";
import { Mic } from "lucide-react";
import { cn } from "cn";

import { PromptInputButton } from "@renderer/components/ai-elements/prompt-input";
import { useSettings } from "@renderer/state/settings";

import type { DictationPhase } from "./dictation";

const HINTS: Record<DictationPhase, string> = {
  idle: "Dictate",
  starting: "Opening the microphone…",
  preparing: "Getting the speech model ready…",
  listening: "Stop dictation",
  finishing: "Finishing…",
};

/** What a screen reader hears as the phase changes; nothing while idle. */
const SAID: Record<DictationPhase, string> = {
  idle: "",
  starting: "",
  preparing: "Getting the speech model ready. This happens once.",
  listening: "Listening",
  finishing: "Finishing",
};

/** How tall each bar stands for the same loudness: uneven, so the meter reads as a voice. */
const BARS = [0.6, 1, 0.75];

/**
 * The microphone, beside send. Idle it is a quiet glyph; open, it fills like
 * stop and its three bars follow the voice, so the person can see they are
 * being heard. Escape on it drops the dictation and puts the box back.
 */
export function DictationButton({
  phase,
  level,
  disabled,
  onToggle,
  onCancel,
}: {
  phase: DictationPhase;
  level: number;
  disabled?: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const reduceMotion = useSettings((state) => state.settings?.reduceMotion ?? false);
  const open = phase === "listening";
  const busy = phase === "starting" || phase === "preparing" || phase === "finishing";
  // Speech sits around 0.02 to 0.2 RMS; this puts a normal voice in the upper half.
  const loudness = Math.min(1, level * 8);
  return (
    <>
      <TooltipHint content={HINTS[phase]}>
        <PromptInputButton
          aria-busy={busy || undefined}
          aria-label={phase === "idle" ? "Dictate" : "Stop dictation"}
          className={cn(
            "size-7 shrink-0 rounded-full",
            // The ghost variant's dark hover is a `dark:` rule, which outranks a plain `hover:`.
            open
              ? "bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:hover:bg-foreground/90"
              : "text-muted-foreground",
          )}
          data-dictation={phase}
          disabled={disabled && phase === "idle"}
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.key === "Escape" && phase !== "idle") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          size="icon-sm"
        >
          {open ? (
            <span aria-hidden className="flex h-3.5 items-center gap-[2px]">
              {BARS.map((weight, index) => (
                <span
                  className={cn("w-[2px] rounded-full bg-current", !reduceMotion && "motion-safe:transition-[height] motion-safe:duration-100")}
                  key={index}
                  style={{ height: `${3 + loudness * weight * 11}px` }}
                />
              ))}
            </span>
          ) : busy && phase !== "starting" ? (
            <LoadingIcon active reducedMotion={reduceMotion} size={18} />
          ) : (
            <Mic className="size-4" />
          )}
        </PromptInputButton>
      </TooltipHint>
      <span aria-live="polite" className="sr-only" role="status">
        {SAID[phase]}
      </span>
    </>
  );
}
