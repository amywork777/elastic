import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelChip, type ModelProvider, type ProviderModelGroup } from "@renderer/features/session/ComposerChips";

const claude: ModelProvider = {
  agentId: "claude-code",
  agentName: "Claude Code",
  icon: null,
  model: {
    id: "model", name: "Model", type: "select", category: "model", description: null, currentValue: "a",
    options: ["a", "b", "c", "d", "e", "f", "g", "h"].map((value) => ({ value, name: `Model ${value.toUpperCase()}`, description: null, group: null, kind: null })),
  } as ModelProvider["model"],
};

const ollama: ProviderModelGroup = { providerId: "ollama", label: "Ollama (via Claude Code)", providerLabel: "Ollama", agentId: "claude-code", icon: null, models: ["qwen3"], installed: true, agentName: "Claude Code" };
const groq: ProviderModelGroup = { providerId: "custom", label: "Groq (via OpenCode)", providerLabel: "Groq", agentId: "opencode", icon: null, models: [], installed: false, agentName: "OpenCode" };

describe("the model picker's providers from Models & keys", () => {
  it("lists each provider's models under its group, and picks one", async () => {
    const onPickProvider = vi.fn();
    render(<ModelChip agentId="claude-code" onChange={vi.fn()} onPickProvider={onPickProvider} providerGroups={[ollama]} providers={[claude]} />);
    await userEvent.click(screen.getByRole("button", { name: "Model A" }));
    expect(screen.getByText("Ollama (via Claude Code)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "qwen3" }));
    expect(onPickProvider).toHaveBeenCalledWith("ollama", "qwen3");
  });

  it("takes a typed model id, offers the install for an agent that is missing, and ends on Add a model", async () => {
    const onPickProvider = vi.fn();
    const onInstallAgent = vi.fn();
    const onAddModel = vi.fn();
    const user = userEvent.setup();
    render(<ModelChip agentId="claude-code" onAddModel={onAddModel} onChange={vi.fn()} onInstallAgent={onInstallAgent} onPickProvider={onPickProvider} providerGroups={[ollama, groq]} providers={[claude]} />);
    await user.click(screen.getByRole("button", { name: "Model A" }));
    await user.click(screen.getByRole("menuitem", { name: "Use a model id…" }));
    await user.type(screen.getByRole("textbox", { name: "Model id for Ollama" }), "llama3.3{Enter}");
    expect(onPickProvider).toHaveBeenCalledWith("ollama", "llama3.3");
    await user.click(screen.getByRole("button", { name: "Model A" }));
    await user.click(screen.getByRole("menuitem", { name: "Install OpenCode" }));
    expect(onInstallAgent).toHaveBeenCalledWith("opencode");
    await user.click(screen.getByRole("button", { name: "Model A" }));
    await user.click(screen.getByRole("menuitem", { name: "Add a model…" }));
    expect(onAddModel).toHaveBeenCalled();
  });

  it("keeps an agent's older models under More models, and labels a chat on a provider by its model and provider", async () => {
    const { unmount } = render(<ModelChip agentId="claude-code" onChange={vi.fn()} providers={[claude]} />);
    await userEvent.click(screen.getByRole("button", { name: "Model A" }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(6);
    expect(screen.getByRole("menuitem", { name: "More models (2)" })).toBeInTheDocument();
    unmount();
    render(<ModelChip agentId="claude-code" onChange={vi.fn()} picked={{ providerId: "ollama", model: "qwen3" }} providerGroups={[ollama]} providers={[claude]} />);
    expect(screen.getByRole("button", { name: "qwen3 · Ollama" })).toBeInTheDocument();
  });
});
