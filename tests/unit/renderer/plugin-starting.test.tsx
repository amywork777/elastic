import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PluginStarting, SLOW_START_MS } from "@renderer/plugins/PluginStarting";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("says the plugin is starting, and after a while that a first start downloads what it needs", () => {
  render(<PluginStarting name="text-to-cad" />);
  expect(screen.getByText(/Starting text-to-cad…/)).toBeInTheDocument();
  expect(screen.queryByText(/first start/)).toBeNull();
  act(() => { vi.advanceTimersByTime(SLOW_START_MS); });
  expect(screen.getByText(/first start can take a few minutes/)).toBeInTheDocument();
});
