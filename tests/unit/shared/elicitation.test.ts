import { describe, expect, it } from "vitest";

import { answerSummary, formComplete, formContent, questionForm } from "@shared/acp/elicitation";

// The shape claude-agent-acp 0.84.0 sends for AskUserQuestion (askUserQuestionsToCreateRequest).
const ask = {
  mode: "form",
  sessionId: "s",
  toolCallId: "t",
  message: "Please answer the following questions.",
  requestedSchema: {
    type: "object",
    properties: {
      question_0: { type: "string", title: "Database", description: "Which database?", oneOf: [{ const: "Postgres", title: "Postgres", description: "Relational" }, { const: "SQLite", title: "SQLite" }] },
      question_0_custom: { type: "string", title: "Other", description: "Type your own answer (optional)." },
      question_1: { type: "array", title: "Features", description: "Which features?", items: { anyOf: [{ const: "Auth", title: "Auth" }, { const: "Billing", title: "Billing" }] } },
    },
  },
};

describe("questions from a form elicitation", () => {
  it("reads single, multi and free-text fields in order", () => {
    const form = questionForm(ask)!;
    expect(form.message).toBe("Please answer the following questions.");
    expect(form.fields.map((field) => [field.key, field.kind, field.options.map((option) => option.value)])).toEqual([
      ["question_0", "single", ["Postgres", "SQLite"]],
      ["question_0_custom", "text", []],
      ["question_1", "multi", ["Auth", "Billing"]],
    ]);
    expect(form.fields[0]!.options[0]!.description).toBe("Relational");
  });

  it("refuses URL mode and an empty schema", () => {
    expect(questionForm({ mode: "url", url: "https://x" })).toBeNull();
    expect(questionForm({ mode: "form", requestedSchema: { type: "object", properties: {} } })).toBeNull();
  });

  it("answers with the picked values, leaving out blanks and values not offered", () => {
    const form = questionForm(ask)!;
    expect(formContent(form, { question_0: "Postgres", question_0_custom: "  ", question_1: ["Auth", "Nope"] })).toEqual({ question_0: "Postgres", question_1: ["Auth"] });
    expect(formContent(form, { question_0: "MySQL" })).toEqual({});
    expect(answerSummary(form, { question_0: "Postgres", question_1: ["Auth", "Billing"] })).toBe("Postgres · Auth, Billing");
  });

  it("converts typed text fields and holds Submit until required ones are answered", () => {
    const form = questionForm({ mode: "form", message: "m", requestedSchema: { type: "object", required: ["n"], properties: { n: { type: "integer" }, ok: { type: "boolean" } } } })!;
    expect(formContent(form, { n: "4.7", ok: "yes" })).toEqual({ n: 4, ok: true });
    expect(formComplete(form, { ok: "no" })).toBe(false);
    expect(formComplete(form, { n: "2" })).toBe(true);
  });
});
