# Models & keys

elastic runs agents it does not write: Claude Code, Codex, OpenCode and the
others in Settings › Agents. "Any model" is a layer over them, not an agent loop
of elastic's own. Settings › Models & keys stores providers (an API key, a local
server, a gateway), and each is routed to the agent that speaks its protocol
(`src/shared/providers.ts`):

| Provider | Protocol | Runs through | How |
| --- | --- | --- | --- |
| Anthropic API key | Anthropic Messages | Claude Code | `ANTHROPIC_API_KEY` in the adapter's environment |
| OpenRouter | Anthropic Messages | Claude Code | `providers/set` to `https://openrouter.ai/api`, the key as a bearer header |
| Ollama | Anthropic Messages (Ollama 0.14 and later) | Claude Code | `providers/set` to the local server |
| OpenAI API key | OpenAI Responses | Codex | `providers/set` gateway to `https://api.openai.com/v1`, so it wins over a ChatGPT login |
| Custom endpoint | Anthropic / OpenAI Responses / OpenAI Chat | Claude Code / Codex / OpenCode | `providers/set`, or OpenCode's inline `OPENCODE_CONFIG_CONTENT` |

`providers/set` is ACP's unstable provider slot, implemented by the pinned
claude-agent-acp 0.84.0 (`main`, apiType `anthropic`) and codex-acp 1.13.1
(`openai`, apiType `openai`, which it maps to the Responses wire API). It is
process-wide in both adapters, and every session has its own adapter process,
so a session on a provider spawns its own (never a warm one) and the provider
is that session's alone (`src/main/acp/sessions.ts`, `connect`). The model the
person picked reaches the agent through its environment: Claude Code's model
tiers (`ANTHROPIC_MODEL` and the rest) or Codex's `CODEX_CONFIG`.

Keys are sealed with Electron's `safeStorage` in `providers.json` under the
app's data directory (`src/main/providers/store.ts`). They never cross IPC
(`providers.list` answers `hasKey`), never go in a session row, and never touch
`~/.claude` or `~/.codex`.

Each provider's Test button makes one cheap real request
(`src/main/providers/test.ts`): Anthropic's and OpenAI's model lists,
OpenRouter's key check, Ollama's tags, a custom endpoint's `/models`.

## Switching models

Within one agent, the model chip switches mid-chat as before. A model from
another agent or provider starts a new linked chat ("Continue with …") whose
first prompt carries a handoff of this one; the two link to each other.
