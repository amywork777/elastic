import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";

import { Composer } from "@renderer/features/session/Composer";
import { NO_CHAT, createChatContext } from "@renderer/plugins/chat-context";
import { appContextBlocks, useComposer } from "@renderer/state/composer";
import type { TakenDraft } from "@renderer/state/composer";
import { useSessions } from "@renderer/state/sessions";

const session = "session-1";
const quickEdit = (text: string) => ({ type: "text", text, _meta: { "openai/title": "Quick edit · a.step" } });
const sketch = { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png", _meta: { "openai/title": "Sketch · a.step" } };

beforeEach(() => {
  useComposer.setState({ drafts: {}, annotations: {}, appContexts: {}, acceptedContexts: {}, referenceLabels: {}, pendingFiles: {}, draftRoots: {}, queues: {}, sending: {} });
  useSessions.setState({ activeId: null });
});

it("keeps text and images with their titles, and leaves out other blocks", () => {
  expect(appContextBlocks([quickEdit("Round it."), sketch, { type: "audio", data: "x", mimeType: "audio/wav" }, { type: "text", text: "  " }])).toEqual([
    { type: "text", text: "Round it.", title: "Quick edit · a.step" },
    { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png", title: "Sketch · a.step" },
  ]);
});

it("an update replaces the frame's earlier one; another frame's stays", async () => {
  const cad = createChatContext({ frameId: "cad", source: "text-to-cad", sessionId: session });
  const other = createChatContext({ frameId: "other", source: "Tables", sessionId: session });
  await cad.updateModelContext({ content: [quickEdit("Round it.")] });
  await other.updateModelContext({ content: [quickEdit("Sort by size.")] });
  await cad.updateModelContext({ content: [quickEdit("Round it."), quickEdit("Make it a cat.")] });
  const held = useComposer.getState().appContexts[session]!;
  expect(held.map((entry) => [entry.frameId, entry.blocks.map((block) => (block.type === "text" ? block.text : "image"))])).toEqual([
    ["other", ["Sort by size."]],
    ["cad", ["Round it.", "Make it a cat."]],
  ]);
});

it("a frame with no session of its own reaches the selected chat, and refuses with none", async () => {
  const page = createChatContext({ frameId: "rail", source: "text-to-cad", sessionId: null });
  await expect(page.updateModelContext({ content: [quickEdit("Round it.")] })).rejects.toThrow(NO_CHAT);
  useSessions.setState({ activeId: "selected" });
  await page.updateModelContext({ content: [quickEdit("Round it.")] });
  expect(useComposer.getState().appContexts.selected?.[0]?.frameId).toBe("rail");
});

it("tells the view its context is empty when the chip is taken out, and when the message goes", async () => {
  const cad = createChatContext({ frameId: "cad", source: "text-to-cad", sessionId: session });
  const cleared = vi.fn();
  const stop = cad.watch(cleared);
  await cad.updateModelContext({ content: [quickEdit("Round it.")] });
  await cad.updateModelContext({ content: [quickEdit("Round it."), quickEdit("Again.")] });
  expect(cleared).not.toHaveBeenCalled();
  useComposer.getState().removeAppContext(session, "cad");
  expect(cleared).toHaveBeenCalledTimes(1);
  await cad.updateModelContext({ content: [quickEdit("Make it a cat.")] });
  const taken = useComposer.getState().takeDraft(session);
  expect(taken.appContexts?.[0]?.blocks).toHaveLength(1);
  expect(cleared).toHaveBeenCalledTimes(2);
  stop();
});

it("ui/message submits the view's message to its chat, as the person's", async () => {
  const submit = vi.fn(async () => {});
  useComposer.setState({ submit });
  const cad = createChatContext({ frameId: "cad", source: "text-to-cad", sessionId: session });
  await cad.message({ role: "user", content: [quickEdit("Make it a cat."), sketch] });
  expect(submit).toHaveBeenCalledWith(session, "Make it a cat.", [
    { type: "text", text: "Make it a cat." },
    { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png", uri: null },
  ]);
  await expect(cad.message({ content: [] })).rejects.toThrow();
});

// The composer's editor is ProseMirror, which measures the selection; jsdom lays nothing out.
const noRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects ??= noRects;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
(Text.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects ??= noRects;

it("shows a chip, and the next message carries the queued text and image after what was typed", async () => {
  const draftKey = "__new__:p";
  useComposer.getState().setAppContext(draftKey, { frameId: "cad", source: "text-to-cad", blocks: appContextBlocks([quickEdit("Make him into a cat."), sketch]) });
  useComposer.getState().setDraft(draftKey, "please");
  const onSubmit = vi.fn(async (_text: string, _content: unknown[], _draft: TakenDraft) => undefined);
  const view = render(createElement(Composer, { sessionId: null, newDraftKey: draftKey, chips: null, commands: [], status: "ready", onSubmit }));
  expect(view.container.querySelector("[data-composer-app-context]")?.textContent).toContain("Quick edit · a.step");
  await act(async () => fireEvent.submit(view.container.querySelector("form")!));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const [text, content] = onSubmit.mock.calls[0]!;
  expect(text).toBe("please");
  expect(content).toEqual([
    { type: "text", text: "please" },
    { type: "text", text: "Make him into a cat." },
    { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png", uri: null },
  ]);
  expect(useComposer.getState().appContexts[draftKey]).toBeUndefined();
});
