/**
 * About and updates. The version, where it came from, the one button the
 * updater's current state allows, and the skills every session is handed.
 */

import { Button } from "@renderer/components/ui/button";
import { Progress } from "@renderer/components/ui/progress";
import {
  ActionRow,
  SettingCard,
  SettingRow,
  SwitchRow,
  ValueRow,
} from "@renderer/features/settings/SettingCard";
import {
  useSettingsPatch,
  useSettingsValue,
} from "@renderer/features/settings/settings-value";
import { StatusLabel } from "@renderer/features/settings/StatusDot";
import { useAppInfo } from "@renderer/features/settings/use-app-info";
import { useSkills } from "@renderer/features/settings/use-skills";
import { useUpdates } from "@renderer/state/updates";
import { toast } from "sonner";

import { APP_NAME, APP_REPO, APP_STAGE } from "@shared/brand";

const REPOSITORY = `https://github.com/${APP_REPO}`;

/** A new issue with the version in the title and a place for the report. */
export function issueUrl(version: string): string {
  const title = `Problem in ${APP_NAME} ${version} ${APP_STAGE}`;
  const body = [
    "What happened, and what did you expect?",
    "",
    "",
    "Steps to reproduce:",
    "1. ",
    "",
    `Diagnostics (Settings › About › Copy diagnostics, then paste here):`,
    "```",
    "",
    "```",
  ].join("\n");
  return `${REPOSITORY}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

async function copyDiagnostics() {
  try {
    const { text } = await window.workbench.app.diagnostics();
    await navigator.clipboard.writeText(text);
    toast.success("Diagnostics copied. Paste them into your issue.");
  } catch {
    toast.error("Could not copy diagnostics.");
  }
}
const LICENSES = `${REPOSITORY}/blob/main/LICENSE`;

const PLATFORMS: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

const openExternal = (url: string) => () => void window.workbench.shell.openExternal({ url });

export function AboutPage() {
  const info = useAppInfo();
  const settings = useSettingsValue();
  const patch = useSettingsPatch();

  return (
    <>
      <SettingCard title="About">
        <ValueRow
          keywords="build number release"
          title="Version"
          tone="strong"
          value={info ? `${info.version} ${APP_STAGE}` : "…"}
        />
        <ValueRow
          keywords="operating system os"
          title="Platform"
          value={info ? (PLATFORMS[info.platform] ?? info.platform) : "…"}
        />
        <ValueRow
          description="Development builds run from a checkout and are never updated in place."
          keywords="stable dev release track"
          title="Channel"
          value={info?.isDev ? "Development" : "Stable"}
        />
      </SettingCard>

      <SettingCard title="Updates">
        <SwitchRow
          checked={settings.checkUpdatesOnLaunch}
          description="Ask GitHub Releases for a newer build at launch, and every six hours after that."
          keywords="automatic check release"
          onChange={(checkUpdatesOnLaunch) => patch({ checkUpdatesOnLaunch })}
          title="Check for updates automatically"
        />
        <UpdateRow />
      </SettingCard>

      <SkillsCard />

      <SettingCard title="Help">
        <ActionRow
          description="A plain-text report of versions, agents, plugins and recent errors, for an issue. Keys and tokens are left out, and nothing is sent anywhere."
          keywords="diagnostics debug report logs support"
          label="Copy diagnostics"
          onClick={() => void copyDiagnostics()}
          title="Diagnostics"
        />
        <ActionRow
          description="Opens a new GitHub issue with the version filled in."
          keywords="bug issue feedback support"
          label="Report a problem"
          onClick={openExternal(issueUrl(info?.version ?? "unknown"))}
          title="Report a problem"
        />
      </SettingCard>

      <SettingCard title="Links">
        <ActionRow
          description="Issues, releases and the source of everything here."
          keywords="github source code"
          label="Open on GitHub"
          onClick={openExternal(REPOSITORY)}
          title="Repository"
        />
        <ActionRow
          description={`${APP_NAME} is MIT-licensed and built on other people's work.`}
          keywords="licences open source attribution mit"
          label="View licenses"
          onClick={openExternal(LICENSES)}
          title="Open-source licenses"
        />
      </SettingCard>
    </>
  );
}

/** A line of the updater's error, not a page of it: main sends one line, this is the backstop. */
const MAX_ERROR_LENGTH = 160;
const clamp = (text: string) =>
  text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1).trimEnd()}…` : text;

/**
 * The updater, as one row: what the state is on the left, the only action that
 * state allows on the right.
 *
 * Nothing downloads without being asked and nothing restarts without being
 * asked — that is why `autoDownload` is off in `src/main/updater.ts`, and why
 * this is a button rather than a progress bar that appeared on its own.
 */
function UpdateRow() {
  const status = useUpdates((state) => state.status);
  const busy = useUpdates((state) => state.busy);
  const check = useUpdates((state) => state.check);
  const download = useUpdates((state) => state.download);
  const install = useUpdates((state) => state.install);

  const version = status.version ? ` ${status.version}` : "";

  const { description, action } = {
    unsupported: {
      description: status.message ?? "Updates are delivered to installed builds; this one runs from a checkout.",
      action: null,
    },
    idle: {
      // Also a release whose feed for this platform is still being uploaded:
      // nothing newer is published for this build. An inactive updater is
      // `unsupported`, not this.
      description: `${APP_NAME} is up to date.`,
      action: { label: "Check now", onClick: check },
    },
    checking: { description: "Checking GitHub Releases…", action: null },
    available: status.manual
      ? {
          // An unsigned macOS build cannot install an update itself (src/main/updater.ts).
          description: `Version${version} is out. Download opens it on GitHub; install it over this one.`,
          action: { label: "Download", onClick: download },
        }
      : {
          description: `Version${version} is available.`,
          action: { label: "Download", onClick: download },
        },
    downloading: {
      // No number here: this is a polite live region, and a percentage that
      // changes every second would be read out every second. The reading is the
      // progress bar's (and is printed beside it, outside the region).
      description: `Downloading${version}…`,
      action: null,
    },
    downloaded: {
      description: `Version${version} is ready. Restarting installs it.`,
      // The visible word stays the start of the name (label in name); the
      // version says which build the button installs.
      action: { label: "Restart", name: `Restart to install${version}`, onClick: install },
    },
    // Main's state, not the IPC round trip: the button stays off for as long as
    // the install is under way (a minute, at most — then it is an error).
    installing: { description: `Restarting to install${version}…`, action: { label: "Restarting…", onClick: install, pending: true } },
    error: {
      description: clamp(status.message ?? "The update check failed."),
      // An install that did not start leaves the download staged: the retry is
      // Restart, not another check.
      action:
        status.version !== undefined
          ? { label: "Restart", name: `Restart to install${version}`, onClick: install }
          : { label: "Try again", onClick: check },
    },
  }[status.state];

  return (
    <SettingRow
      control={
        action ? (
          <Button
            className="h-8"
            aria-label={busy || action.pending ? undefined : action.name}
            disabled={busy || action.pending}
            onClick={() => void action.onClick()}
            size="sm"
            variant={status.state === "downloaded" || status.state === "installing" ? "default" : "secondary"}
          >
            {busy && action.onClick === install ? "Restarting…" : action.label}
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">
            {status.state === "downloading"
              ? `${Math.round(status.percent ?? 0)}%`
              : status.state === "checking"
                ? "…"
                : "—"}
          </span>
        )
      }
      description={description}
      keywords="update download install restart version"
      live
      title="Software update"
    >
      {status.state === "downloading" ? (
        // The vendored Progress draws `value` but does not hand it to Radix's
        // root, which would then announce an indeterminate bar: the reading is
        // passed as the ARIA attribute as well.
        <Progress
          aria-label="Update download progress"
          aria-valuenow={Math.round(status.percent ?? 0)}
          className="h-1"
          value={Math.round(status.percent ?? 0)}
        />
      ) : null}
    </SettingRow>
  );
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                      */
/* -------------------------------------------------------------------------- */

/** The skills every session is handed: the app's own and every enabled plugin's. */
function SkillsCard() {
  const skills = useSkills();
  return (
    <SettingCard title="Skills">
      <SettingRow
        control={
          <StatusLabel tone={skills && skills.skills.length > 0 ? "ok" : "idle"}>
            {skills && skills.skills.length > 0 ? `${skills.skills.length} skills` : "—"}
          </StatusLabel>
        }
        description={skills?.root ?? "The skills every session in this app is handed: the app's own and its plugins'."}
        keywords="skills plugins browser pdf documents terminals additional directories preamble"
        title="Skills"
      >
        {skills?.root ? (
          <p className="text-[11px] text-muted-foreground">
            Handed to every session as an extra directory. Nothing is installed into an
            agent&apos;s own configuration.
          </p>
        ) : null}
      </SettingRow>
    </SettingCard>
  );
}
