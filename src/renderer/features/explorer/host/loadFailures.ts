import { createPromptContext, textPart } from "@workbench/core/prompt";
import type { PromptContextPort } from "@workbench/core/prompt";
import type { ClipboardPort, ViewerHost, ViewerLoadFailure } from "@workbench/ui/host";

type Class = "build" | "network" | "load" | "empty" | "edit" | "other";

/** What went wrong, by the alert's kind: each is described and handed to the agent differently. */
function classOf(kind: string | undefined): Class {
  switch (kind) {
    case "compile": case "artifact": case "service": case "http": case "response": return "build";
    case "network": return "network";
    case "mesh": return "load";
    case "empty": return "empty";
    case "edit": return "edit";
    default: return "other";
  }
}

const named = (failure: ViewerLoadFailure) => failure.file ? `“${failure.file}”` : "this file";

/** The diagnostic as the agent receives it: what failed, what to do about it, and the complete output. */
export function loadFailurePrompt(failure: ViewerLoadFailure): string {
  const file = named(failure);
  const ask = {
    build: `${file} could not be built: ${failure.title}. Fix the source so it builds, then rebuild it.`,
    network: `The viewer lost contact with the service rendering ${file} while loading it. Find out why.`,
    load: `The viewer could not read ${file}: ${failure.title}. Check that the file is complete and valid, and regenerate it if it is not.`,
    empty: `${file} loaded but has nothing to display. Check that it is written out completely, and regenerate it if it is not.`,
    edit: `A live edit of ${file} failed: ${failure.title}. Fix it so the update applies, then run it again.`,
    other: `The viewer could not display ${file}: ${failure.title}. Find out why and fix it.`,
  }[classOf(failure.kind)];
  const diagnostic = failure.details || failure.reason || failure.message || failure.title;
  return `${ask}\n\n\`\`\`\n${diagnostic}\n\`\`\``;
}

/**
 * A renderer's load failure (a plugin's viewer that could not build or reach its service):
 * the next step is the session's agent. A build failure says a build reported it, with the
 * builder's words beneath; a lost connection says so; any other failure keeps the card's
 * own words. Every failure offers the diagnostic to the session's prompt
 * (the same delivery "Add to prompt" uses, unavailable while that session is) and to the
 * clipboard, beside Try again.
 */
export function createDesktopLoadFailures(promptContext: PromptContextPort, clipboard: ClipboardPort): NonNullable<ViewerHost["loadFailures"]> {
  return {
    recover(failure) {
      const kept = failure.blocking ? "" : " The previous version stays on screen.";
      const text = loadFailurePrompt(failure);
      const kind = classOf(failure.kind);
      const words = kind === "build"
        ? { message: `Building ${named(failure)} reported an error.${kept}`, recovery: "Ask the agent to fix the source, or copy the details." }
        : kind === "network"
          ? { message: `The viewer lost contact with its service while loading ${named(failure)}.${kept}`, recovery: "Try again. If it keeps happening, copy the details." }
          : {};
      const destination = promptContext.getSnapshot();
      return {
        ...words,
        actions: [
          {
            label: "Ask the agent to fix",
            ...(destination.available ? {} : { disabled: true, reason: destination.reason ?? "This tab's session can't take a prompt." }),
            run: async () => {
              const result = await promptContext.deliver(createPromptContext([textPart(text, "load-failure")]));
              if (result.status === "failed" || result.status === "partial") throw new Error(result.message || "Could not add the error to the prompt.");
              // A destination that went away mid-delivery cancels with its reason.
              return result.status === "added" ? "Added to the prompt." : "message" in result ? result.message ?? "" : "";
            },
          },
          {
            label: "Copy details",
            run: async () => { await clipboard.writeText(failure.details || text); return "Copied."; },
          },
        ],
      };
    },
  };
}
