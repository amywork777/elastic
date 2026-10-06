/**
 * General (plan §10): where files come from and go, and what the app is
 * allowed to do outside its own window — start itself, sit in the menu bar,
 * make a noise, count a launch.
 */
import { useState } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@renderer/components/ui/button";
import { Switch } from "@renderer/components/ui/switch";
import {
  PathRow,
  SelectRow,
  SettingCard,
  SettingRow,
  SwitchRow,
  TextRow,
} from "@renderer/features/settings/SettingCard";
import { playNotificationSound } from "@renderer/features/settings/sound";
import {
  useSettingsFallbacks,
  useSettingsPatch,
  useSettingsValue,
} from "@renderer/features/settings/settings-value";
import { isMac } from "@renderer/lib/platform";
import type { FileOpenDestination, NotificationSoundTiming } from "@shared/types";

const OPEN_WITH: { value: FileOpenDestination; label: string }[] = [
  { value: "reveal", label: isMac ? "Reveal in Finder" : "Show in Explorer" },
  { value: "editor", label: "Default editor" },
  { value: "custom", label: "Custom command" },
];

const TIMING: { value: NotificationSoundTiming; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "unfocused", label: "When unfocused" },
];

export function GeneralPage() {
  const settings = useSettingsValue();
  const patch = useSettingsPatch();
  const fallbacks = useSettingsFallbacks();
  const [clearing, setClearing] = useState(false);

  return (
    <>
      <SettingCard title="Files and projects">
        <PathRow
          description="Where the Open folder chooser opens."
          keywords="directory workspace"
          onChoose={() => {
            void window.workbench.dialogs
              .chooseDirectory({
                title: "Default project folder",
                defaultPath: settings.defaultProjectFolder ?? undefined,
              })
              .then((chosen) => chosen && patch({ defaultProjectFolder: chosen.path }));
          }}
          note={
            fallbacks.gone.defaultProjectFolder?.reason === "file"
              ? "This is a file, not a folder, so the chooser opens where it last did."
              : fallbacks.gone.defaultProjectFolder
                ? "This folder no longer exists, so the chooser opens where it last did."
                : undefined
          }
          onClear={() => patch({ defaultProjectFolder: null })}
          placeholder="Your home folder"
          title="Default project folder"
          value={settings.defaultProjectFolder}
        />
        <SelectRow
          description="What “Open” does with a file the explorer is showing."
          keywords="finder explorer editor external"
          onChange={(fileOpenDestination) => patch({ fileOpenDestination })}
          options={OPEN_WITH}
          title="Open files with"
          value={settings.fileOpenDestination}
        />
        {settings.fileOpenDestination === "custom" ? (
          <TextRow
            description="Run for the file being opened. {path} is replaced with its absolute path."
            keywords="command line argument"
            onChange={(fileOpenCommand) => patch({ fileOpenCommand })}
            placeholder="code -g {path}"
            title="Custom command"
            value={settings.fileOpenCommand}
            width="w-[280px]"
          />
        ) : null}
        <SelectRow
          description="elastic follows the system language. More languages are not translated yet."
          keywords="locale translation"
          onChange={(language) => patch({ language })}
          options={[{ value: "auto", label: "Auto" }]}
          title="Language"
          value={settings.language}
          width="w-[140px]"
        />
      </SettingCard>

      <SettingCard title="App">
        <SwitchRow
          checked={settings.launchAtLogin}
          description="Start elastic when you log in."
          keywords="startup boot"
          onChange={(launchAtLogin) => patch({ launchAtLogin })}
          title="Launch at login"
        />
        {isMac ? (
          <SwitchRow
            checked={settings.showInMenuBar}
            description="Keep an elastic item in the menu bar for bringing the window back."
            keywords="tray status bar"
            onChange={(showInMenuBar) => patch({ showInMenuBar })}
            title="Show in menu bar"
          />
        ) : null}
      </SettingCard>

      <SettingCard title="Notifications">
        <SwitchRow
          checked={settings.notificationsEnabled}
          description="Tell me when a turn finishes or an agent asks for permission."
          keywords="notify alert"
          onChange={(notificationsEnabled) => patch({ notificationsEnabled })}
          title="Notifications"
        />
        <SettingRow
          control={(describedBy) => (
            <>
              <Button
                className="h-8 gap-1.5"
                disabled={!settings.notificationsEnabled || !settings.notificationSound}
                onClick={() => void playNotificationSound(settings.notificationSoundFile)}
                size="sm"
                variant="secondary"
              >
                <Play className="size-3.5" />
                Preview
              </Button>
              <Switch
                aria-describedby={describedBy}
                aria-label="Sound"
                checked={settings.notificationSound}
                disabled={!settings.notificationsEnabled}
                onCheckedChange={(notificationSound) => patch({ notificationSound })}
              />
            </>
          )}
          description="Play a sound with the notification."
          keywords="audio chime"
          title="Sound"
        />
        <PathRow
          chooseLabel="Choose…"
          description="An aiff, wav, mp3, m4a or ogg file. Empty plays elastic's own chime."
          keywords="audio file custom"
          onChoose={() => {
            void window.workbench.dialogs
              .chooseFile({
                title: "Notification sound",
                filters: [{ name: "Audio", extensions: ["aiff", "aif", "wav", "mp3", "m4a", "ogg"] }],
              })
              .then((chosen) => chosen && patch({ notificationSoundFile: chosen.path }));
          }}
          onClear={() => patch({ notificationSoundFile: null })}
          placeholder="elastic chime"
          title="Custom sound"
          value={settings.notificationSoundFile}
        />
        <SelectRow
          description="Whether the sound plays while you are looking at the window."
          keywords="focus background"
          onChange={(notificationSoundTiming) => patch({ notificationSoundTiming })}
          options={TIMING}
          title="Play sound"
          value={settings.notificationSoundTiming}
          width="w-[180px]"
        />
        <SwitchRow
          checked={settings.notificationOsBanners}
          description="Also show them as banners in the system's notification centre, not only inside elastic."
          keywords="os banner system notification centre center"
          onChange={(notificationOsBanners) => patch({ notificationOsBanners })}
          title="System banners"
        />
      </SettingCard>

      <SettingCard title="Browser">
        <SettingRow
          control={() => (
            <Button
              className="h-8"
              disabled={clearing}
              onClick={() => {
                setClearing(true);
                void window.workbench.browser
                  .clearData()
                  .then(() => toast.success("Browser data cleared", { description: "Every site in the browser tab is signed out." }))
                  .catch(() => toast.error("Could not clear browser data"))
                  .finally(() => setClearing(false));
              }}
              size="sm"
              variant="secondary"
            >
              Clear browser data
            </Button>
          )}
          description="The browser tab keeps one sign-in for every chat. This signs you out of every site and removes its cookies and cache."
          keywords="cookies cache sign out logout login storage"
          title="Browser data"
        />
      </SettingCard>

    </>
  );
}
