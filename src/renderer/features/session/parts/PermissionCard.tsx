import { TooltipHint } from "@workbench/ui/primitives/tooltip";
import { Check, MessageCircleQuestion, ShieldQuestion, X } from "lucide-react";
import { useState } from "react";

import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@renderer/components/ai-elements/confirmation";
import { useAcp } from "@renderer/state/acp";
import { useComposer } from "@renderer/state/composer";
import { errorMessage } from "@shared/ipc/errors";
import type { PermissionOption, PermissionRequestPart } from "@shared/acp/types";
import { answerSummary, formComplete, type QuestionAnswers, type QuestionField, type QuestionForm } from "@shared/acp/elicitation";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";

/** The card's line for a refusal that carries no reason of its own. */
const EXPIRED = "This request has expired — reconnect and ask again.";

/**
 * A `session/request_permission` as AI Elements' Confirmation: the title
 * and description the adapter sent in `_meta`, and one button per option
 * the agent offered — its own ids, its own names — so "Yes, always" means
 * whatever the agent means by it (plan §6).
 *
 * Once answered the card folds to one activity-sized line, so the
 * transcript still says what was decided without taking the room the
 * question did.
 *
 * An answer main refuses — the adapter is gone (a session reopened after a
 * crash), or the request was already answered — says so on the card; it is
 * never a click that silently does nothing. The card shows main's own
 * reason (not connected, expired, an IPC failure), and the expired line only
 * when the rejection carries no message.
 */

export function PermissionCard({ part, sessionId }: { part: PermissionRequestPart; sessionId: string }) {
  if (part.question) return <QuestionCard form={part.question} part={part} sessionId={sessionId} />;
  return <PermissionRequestCard part={part} sessionId={sessionId} />;
}

function PermissionRequestCard({ part, sessionId }: { part: PermissionRequestPart; sessionId: string }) {
  const respond = useAcp((state) => state.respondPermission);
  /** Main's reason an answer was refused, shown on the card; null until one is. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const outcome = part.outcome;

  if (outcome.state !== "pending") {
    const chosen =
      outcome.state === "selected"
        ? (part.options.find((option) => option.optionId === outcome.optionId) ?? null)
        : null;
    const approved = chosen ? chosen.kind === "allow_once" || chosen.kind === "allow_always" : false;
    return (
      <div
        className="not-prose flex items-center gap-2 px-1.5 py-1 text-[13px] leading-5 text-muted-foreground"
        data-outcome={outcome.state}
        data-permission={part.requestId}
      >
        <span className="flex size-4 items-center justify-center">
          {approved ? <Check className="size-3.5" /> : <X className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <InlineCode text={verdictLine(outcome.state === "cancelled" ? null : approved, chosen, part.title)} />
        </span>
      </div>
    );
  }

  return (
    <Confirmation
      approval={{ id: part.requestId }}
      className="not-prose my-2 gap-3 bg-card px-4 py-3 text-[13px] shadow-xs"
      data-outcome="pending"
      data-permission={part.requestId}
      state="approval-requested"
    >
      <ConfirmationTitle className="flex items-start gap-2.5 leading-5">
        <ConfirmationRequest>
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
            <ShieldQuestion className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">
              <InlineCode text={part.title ?? "Permission requested"} />
            </span>
            {part.description ? (
              <span className="mt-0.5 block text-muted-foreground">
                <InlineCode text={part.description} />
              </span>
            ) : null}
          </span>
        </ConfirmationRequest>
      </ConfirmationTitle>
      <ConfirmationActions className="flex-wrap justify-end gap-2">
        {orderOptions(part.options).map((option) => (
          <TooltipHint content={option.description ?? undefined} key={option.optionId}>
            <ConfirmationAction
              className="h-7 px-2.5 text-[12px]"
              onClick={() => {
                setRefusal(null);
                // The answered card folds to a line and takes the button that was pressed with it,
                // which left focus on the page; an answer goes back to the box the next word is typed in.
                respond(sessionId, part.requestId, option.optionId).then(
                  () => useComposer.getState().requestFocus(sessionId),
                  (error: unknown) => setRefusal(errorMessage(error) || EXPIRED),
                );
              }}
              variant={variantFor(option)}
            >
              {option.name}
            </ConfirmationAction>
          </TooltipHint>
        ))}
      </ConfirmationActions>
      {refusal ? (
        <p className="text-[12px] leading-5 text-muted-foreground" role="status">
          {refusal}
        </p>
      ) : null}
    </Confirmation>
  );
}

/**
 * A question the agent asked (form elicitation: Claude Code's AskUserQuestion, Codex's
 * request_user_input): each field's options as buttons, one pick or several, free text for the
 * rest; Submit answers, Skip cancels. Answered, it folds to the answers on one line.
 */
function QuestionCard({ form, part, sessionId }: { form: QuestionForm; part: PermissionRequestPart; sessionId: string }) {
  const respond = useAcp((state) => state.respondPermission);
  const [answers, setAnswers] = useState<QuestionAnswers>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const outcome = part.outcome;

  if (outcome.state !== "pending") {
    const answered = outcome.state === "answered";
    return (
      <div className="not-prose flex items-center gap-2 px-1.5 py-1 text-[13px] leading-5 text-muted-foreground" data-outcome={outcome.state} data-question={part.requestId}>
        <span className="flex size-4 items-center justify-center">{answered ? <Check className="size-3.5" /> : <X className="size-3.5" />}</span>
        <span className="min-w-0 flex-1 truncate">
          {answered ? `Answered: ${answerSummary(form, outcome.answers) || "no answer"}` : `Skipped: ${form.message}`}
        </span>
      </div>
    );
  }

  const send = (values: QuestionAnswers | null) => {
    setRefusal(null);
    respond(sessionId, part.requestId, null, values ?? undefined).then(
      () => useComposer.getState().requestFocus(sessionId),
      (error: unknown) => setRefusal(errorMessage(error) || EXPIRED),
    );
  };
  const set = (key: string, value: string | string[]) => setAnswers((current) => ({ ...current, [key]: value }));

  return (
    <section
      aria-label={form.message}
      className="not-prose my-2 flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 text-[13px] shadow-xs"
      data-outcome="pending"
      data-question={part.requestId}
    >
      <div className="flex items-start gap-2.5 leading-5">
        <MessageCircleQuestion aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{form.message}</span>
      </div>
      {form.fields.map((field) => (
        <QuestionFieldRow field={field} key={field.key} onChange={(value) => set(field.key, value)} value={answers[field.key]} />
      ))}
      <div className="flex justify-end gap-2">
        <Button className="h-7 px-2.5 text-[12px]" onClick={() => send(null)} size="sm" variant="ghost">Skip</Button>
        <Button className="h-7 px-2.5 text-[12px]" disabled={!formComplete(form, answers)} onClick={() => send(answers)} size="sm">Submit</Button>
      </div>
      {refusal ? <p className="text-[12px] leading-5 text-muted-foreground" role="status">{refusal}</p> : null}
    </section>
  );
}

function QuestionFieldRow({ field, value, onChange }: { field: QuestionField; value: string | string[] | undefined; onChange: (value: string | string[]) => void }) {
  const label = field.prompt ?? field.title;
  if (field.kind === "text") {
    return (
      <label className="flex flex-col gap-1">
        {label ? <span className="text-muted-foreground">{label}</span> : null}
        <input
          className="h-8 rounded-md border bg-transparent px-2 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-question-field={field.key}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.title === "Other" ? "Type your own answer" : undefined}
          value={typeof value === "string" ? value : ""}
        />
      </label>
    );
  }
  const picked = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return (
    <div aria-label={label ?? field.key} className="flex flex-col gap-1.5" role={field.kind === "multi" ? "group" : "radiogroup"}>
      {label ? <span className="text-muted-foreground">{label}</span> : null}
      <div className="flex flex-wrap gap-1.5">
        {field.options.map((option) => {
          const on = picked.includes(option.value);
          return (
            <TooltipHint content={option.description ?? undefined} key={option.value}>
              <button
                aria-checked={field.kind === "single" ? on : undefined}
                aria-pressed={field.kind === "multi" ? on : undefined}
                className={cn(
                  "h-7 rounded-md border px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  on ? "border-foreground/40 bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
                data-question-option={option.value}
                onClick={() => onChange(field.kind === "multi" ? (on ? picked.filter((entry) => entry !== option.value) : [...picked, option.value]) : option.value)}
                role={field.kind === "single" ? "radio" : undefined}
                type="button"
              >
                {option.label}
              </button>
            </TooltipHint>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The folded card, as one statement of what was decided about what:
 * "Allowed: delete the build directory". The question is turned into the
 * thing it asked about (its `?` dropped, its first letter lowered unless the
 * word is an acronym or a path), so the line does not repeat a question that
 * has been answered. `approved` is null for a cancelled request. "Always"
 * is the one option name worth keeping, because it outlives the turn.
 */
export function verdictLine(
  approved: boolean | null,
  chosen: PermissionOption | null,
  title: string | null,
): string {
  const verdict =
    approved === null
      ? "Cancelled"
      : approved
        ? chosen?.kind === "allow_always"
          ? "Always allowed"
          : "Allowed"
        : chosen?.kind === "reject_always"
          ? "Always rejected"
          : "Rejected";
  const subject = title ? subjectOf(title) : "";
  if (subject) {
    return `${verdict}: ${subject}`;
  }
  return chosen && approved !== null ? `${verdict} (${chosen.name})` : verdict;
}

function subjectOf(title: string): string {
  const trimmed = title.trim().replace(/\s*\?+$/, "");
  // "Delete the build directory" → "delete the build directory", but
  // "README.md", "`rm -rf`" and "CI" keep their case.
  return /^[A-Z][a-z]/.test(trimmed) ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : trimmed;
}

/**
 * The adapter's title and description are Markdown-ish: a command arrives
 * as `` `rm -rf build` ``. Backtick spans become inline code; everything
 * else is plain text (no Markdown renderer for one line of a card).
 */
function InlineCode({ text }: { text: string }) {
  const pieces = text.split(/(`[^`\n]+`)/g);
  return (
    <>
      {pieces.map((piece, index) =>
        piece.length > 2 && piece.startsWith("`") && piece.endsWith("`") ? (
          <code
            className="rounded bg-muted px-1 py-px font-mono text-[12px] text-foreground/90"
            key={index}
          >
            {piece.slice(1, -1)}
          </code>
        ) : (
          piece
        ),
      )}
    </>
  );
}

/** Allow first, reject last — the order Codex lays its buttons out in. */
function orderOptions(options: PermissionOption[]): PermissionOption[] {
  const rank: Record<PermissionOption["kind"], number> = {
    allow_once: 0,
    allow_always: 1,
    reject_once: 2,
    reject_always: 3,
  };
  return [...options].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

function variantFor(option: PermissionOption): "default" | "outline" | "ghost" {
  switch (option.kind) {
    case "allow_once":
      return "default";
    case "allow_always":
      return "outline";
    default:
      return "ghost";
  }
}
