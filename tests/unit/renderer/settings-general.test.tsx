import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "@workbench/ui/primitives/tooltip";
import { SettingsRoute } from "@renderer/features/settings/SettingsRoute";
import { useSettings } from "@renderer/state/settings";
import { useUi } from "@renderer/state/ui";
import { defaultSettings } from "@shared/types";

/**
 * Settings › General.
 */
beforeEach(() => {
  useUi.setState({ route: "settings", settingsSection: "general", commandPaletteOpen: false });
  useSettings.setState({ settings: defaultSettings(), ready: true });
});

describe("Settings › General", () => {
  it("names every extension the sound chooser allows", async () => {
    render(<TooltipProvider><SettingsRoute /></TooltipProvider>);
    expect(await screen.findByText(/An aiff, wav, mp3, m4a or ogg file/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Choose custom sound" }));
    expect(window.workbench.dialogs.chooseFile).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [expect.objectContaining({ extensions: expect.arrayContaining(["ogg"]) })] }),
    );
  });

  it("notes a default project folder that no longer exists", async () => {
    useSettings.setState({ settings: { ...defaultSettings(), defaultProjectFolder: "/gone" }, ready: true });
    vi.mocked(window.workbench.settings.fallbacks).mockResolvedValue({ refused: {}, gone: { defaultProjectFolder: { path: "/gone", reason: "missing" } } });
    render(<TooltipProvider><SettingsRoute /></TooltipProvider>);
    expect(await screen.findByText(/no longer exists, so the chooser opens where it last did/)).toBeInTheDocument();
  });

  it("says a default project folder that is now a file is a file, not a missing folder", async () => {
    useSettings.setState({ settings: { ...defaultSettings(), defaultProjectFolder: "/a-file" }, ready: true });
    vi.mocked(window.workbench.settings.fallbacks).mockResolvedValue({ refused: {}, gone: { defaultProjectFolder: { path: "/a-file", reason: "file" } } });
    render(<TooltipProvider><SettingsRoute /></TooltipProvider>);
    expect(await screen.findByText(/is a file, not a folder, so the chooser opens where it last did/)).toBeInTheDocument();
    expect(screen.queryByText(/no longer exists/)).not.toBeInTheDocument();
  });

  it("does not call a refused (wrong-typed) default project folder gone", async () => {
    vi.mocked(window.workbench.settings.fallbacks).mockResolvedValue({ refused: { defaultProjectFolder: "7" }, gone: {} });
    render(<TooltipProvider><SettingsRoute /></TooltipProvider>);
    await screen.findByText("Default project folder");
    await waitFor(() => expect(window.workbench.settings.fallbacks).toHaveBeenCalled());
    expect(screen.queryByText(/no longer exists/)).not.toBeInTheDocument();
  });

  it("ties each row's description to its control, and names the path buttons by their row", async () => {
    useSettings.setState({ settings: { ...defaultSettings(), defaultProjectFolder: "/work", notificationSoundFile: "/chime.wav" }, ready: true });
    render(<TooltipProvider><SettingsRoute /></TooltipProvider>);
    expect(screen.getByRole("switch", { name: "Sound" })).toHaveAccessibleDescription(/Play a sound with the notification/);
    expect(screen.getByRole("combobox", { name: "Open files with" })).toHaveAccessibleDescription(/What .Open. does with a file/);
    const choose = screen.getAllByRole("button", { name: /^Choose/ }).map((button) => button.getAttribute("aria-label"));
    expect(choose).toEqual(["Choose default project folder", "Choose custom sound"]);
    expect(new Set(choose).size).toBe(choose.length);
    expect(screen.getByRole("button", { name: "Reset default project folder" })).toHaveAccessibleDescription(/Where the Open folder chooser opens/);
    expect(screen.getByRole("button", { name: "Reset custom sound" })).toBeInTheDocument();
  });
});
