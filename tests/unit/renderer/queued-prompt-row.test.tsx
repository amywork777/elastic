import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { QueuedPromptRow } from "@renderer/features/session/composer/QueuedPromptRow";
import { useComposer } from "@renderer/state/composer";

const SESSION = "s1";
const item = { id: "q1", text: "make it red", content: [{ type: "text" as const, text: "make it red" }] };

beforeEach(() => {
  useComposer.setState({ queues: { [SESSION]: [item] }, editingQueued: {}, sending: {}, paused: {} });
});
afterEach(() => cleanup());

const row = (onRemove = vi.fn()) => {
  const queued = useComposer.getState().queues[SESSION]![0]!;
  return render(<ul><QueuedPromptRow index={0} item={queued} onRemove={onRemove} sessionId={SESSION} /></ul>);
};

it("opens in place on click, saves with Enter, and holds the prompt while open", () => {
  const { rerender } = row();
  fireEvent.click(screen.getByRole("button", { name: "make it red" }));
  expect(useComposer.getState().editingQueued[SESSION]).toBe("q1");
  const box = screen.getByRole("textbox", { name: "Edit queued prompt" });
  fireEvent.change(box, { target: { value: "make it blue" } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(useComposer.getState().queues[SESSION]![0]!.text).toBe("make it blue");
  expect(useComposer.getState().editingQueued[SESSION]).toBeUndefined();
  rerender(<ul><QueuedPromptRow index={0} item={useComposer.getState().queues[SESSION]![0]!} onRemove={vi.fn()} sessionId={SESSION} /></ul>);
  expect(screen.getByRole("button", { name: "make it blue" })).toBeTruthy();
});

it("Escape leaves it as it was; the Edit and Remove actions are named", () => {
  const onRemove = vi.fn();
  row(onRemove);
  fireEvent.click(screen.getByRole("button", { name: "Edit queued prompt: make it red" }));
  const box = screen.getByRole("textbox", { name: "Edit queued prompt" });
  fireEvent.change(box, { target: { value: "something else" } });
  fireEvent.keyDown(box, { key: "Escape" });
  expect(useComposer.getState().queues[SESSION]![0]!.text).toBe("make it red");
  expect(useComposer.getState().editingQueued[SESSION]).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Remove from queue: make it red" }));
  expect(onRemove).toHaveBeenCalledOnce();
});
