/**
 * An agent's form elicitation (`elicitation/create`, mode `form`) as the questions a card asks, and
 * the person's answers back into the form's content. Claude Code's AskUserQuestion arrives this way
 * (claude-agent-acp: one select per question plus an "Other" text field), and so does Codex's
 * request_user_input (codex-acp). Pure: the reducer, main and the card share it.
 *
 * Every property of the requested schema is one field, in the schema's order: a string with
 * `oneOf`/`enum` options is a single choice, an array whose `items` carry `anyOf`/`enum` options is
 * several, and any other string is free text. Numbers and booleans are free text too, converted on
 * the way out.
 */
export type QuestionOption = { value: string; label: string; description: string | null };

export type QuestionField = {
  key: string;
  /** The schema's title (Claude's question header, "Other" for its free-text companion). */
  title: string | null;
  /** The schema's description (the question itself when a form asks several). */
  prompt: string | null;
  kind: "single" | "multi" | "text";
  options: QuestionOption[];
  required: boolean;
  /** For a text field: what the answer is converted to. */
  valueType?: "string" | "number" | "integer" | "boolean";
};

export type QuestionForm = { message: string; fields: QuestionField[] };

export type QuestionAnswers = Record<string, string | string[]>;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

function optionsOf(schema: Record<string, unknown> | null): QuestionOption[] {
  if (!schema) return [];
  const listed = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null;
  if (listed) {
    return listed.flatMap((entry) => {
      const option = record(entry);
      const value = option?.const;
      if (typeof value !== "string") return [];
      return [{ value, label: text(option?.title) ?? value, description: text(option?.description) }];
    });
  }
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    return schema.enum.flatMap((value, index) =>
      typeof value === "string" ? [{ value, label: text(names[index]) ?? value, description: null }] : []);
  }
  return [];
}

/** The form's questions, or null for anything that is not a form this card can ask. */
export function questionForm(raw: unknown): QuestionForm | null {
  const request = record(raw);
  if (!request || request.mode !== "form") return null;
  const schema = record(request.requestedSchema);
  const properties = record(schema?.properties);
  if (!properties) return null;
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((key): key is string => typeof key === "string") : []);
  const fields: QuestionField[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const property = record(value);
    if (!property) continue;
    const base = { key, title: text(property.title), prompt: text(property.description), required: required.has(key) };
    if (property.type === "array") {
      const options = optionsOf(record(property.items));
      if (options.length > 0) fields.push({ ...base, kind: "multi", options });
      continue;
    }
    const options = property.type === "string" ? optionsOf(property) : [];
    if (options.length > 0) {
      fields.push({ ...base, kind: "single", options });
      continue;
    }
    const valueType = property.type === "number" || property.type === "integer" || property.type === "boolean" ? property.type : "string";
    fields.push({ ...base, kind: "text", options: [], valueType });
  }
  if (fields.length === 0) return null;
  return { message: text(request.message) ?? "The agent has a question.", fields };
}

/** The person's answers as the form's content: blank answers left out, typed values converted. */
export function formContent(form: QuestionForm, answers: QuestionAnswers): Record<string, string | number | boolean | string[]> {
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const field of form.fields) {
    const answer = answers[field.key];
    if (answer === undefined) continue;
    if (field.kind === "multi") {
      const picked = (Array.isArray(answer) ? answer : [answer]).filter((value) => field.options.some((option) => option.value === value));
      if (picked.length > 0) content[field.key] = picked;
      continue;
    }
    const value = Array.isArray(answer) ? answer[0] : answer;
    if (value === undefined || value.trim() === "") continue;
    if (field.kind === "single") {
      if (field.options.some((option) => option.value === value)) content[field.key] = value;
      continue;
    }
    if (field.valueType === "boolean") content[field.key] = /^(true|yes|1)$/i.test(value.trim());
    else if (field.valueType === "number" || field.valueType === "integer") {
      const number = Number(value);
      if (Number.isFinite(number)) content[field.key] = field.valueType === "integer" ? Math.trunc(number) : number;
    } else content[field.key] = value;
  }
  return content;
}

/** Whether every required field has an answer. */
export function formComplete(form: QuestionForm, answers: QuestionAnswers): boolean {
  const content = formContent(form, answers);
  return form.fields.every((field) => !field.required || field.key in content);
}

/** The folded card's line: each answer, by its field's title or prompt. */
export function answerSummary(form: QuestionForm, answers: QuestionAnswers): string {
  const content = formContent(form, answers);
  const parts = form.fields.flatMap((field) => {
    const value = content[field.key];
    if (value === undefined) return [];
    const labels = (Array.isArray(value) ? value : [String(value)]).map((entry) => field.options.find((option) => option.value === entry)?.label ?? entry);
    return [labels.join(", ")];
  });
  return parts.join(" · ");
}
