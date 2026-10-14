import {
  Info,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  Shield,
  SlidersHorizontal,
  Sun,
  Terminal,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Segmented, Select, Switch } from "@/components/ui/controls";
import { SectionTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { PageHeader, Panel } from "@/components/ui/misc";
import type { AppSettings, CursorStyle, ThemeMode, UiLanguage } from "@/domain/types";
import { useT } from "@/lib/i18n";
import { SHORTCUTS, type ShortcutDef } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { resolveTheme, useSettings } from "@/stores/settings";

import { AUTO_SCHEME, TERMINAL_SCHEMES, getScheme } from "../terminal/themes";

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

function Section({
  id,
  title,
  icon,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 space-y-2">
      <SectionTitle className="flex items-center gap-1.5 [&_svg]:size-3.5">
        {icon}
        {title}
      </SectionTitle>
      <Panel className="divide-y divide-line">{children}</Panel>
    </section>
  );
}

/** Numeric input that validates a range and only commits valid values. */
function NumberField({
  value,
  min,
  max,
  step = 1,
  onCommit,
  label,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (v: number) => void;
  label: string;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(String(value));
  }
  const n = Number(text);
  const invalid = text.trim() === "" || !Number.isFinite(n) || n < min || n > max;
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={label}
        value={text}
        inputMode="decimal"
        aria-invalid={invalid || undefined}
        className="w-24 text-right"
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() && Number.isFinite(v) && v >= min && v <= max)
            onCommit(step < 1 ? v : Math.round(v));
        }}
        onBlur={() => invalid && setText(String(value))}
        title={`${min}–${max}`}
      />
      {suffix && <span className="w-8 text-xs text-faint">{suffix}</span>}
    </div>
  );
}

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: <Palette /> },
  { id: "terminal", label: "Terminal", icon: <Terminal /> },
  { id: "ssh", label: "Connections", icon: <SlidersHorizontal /> },
  { id: "safety", label: "Safety", icon: <Shield /> },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard /> },
  { id: "about", label: "About", icon: <Info /> },
];

export function SettingsView() {
  const tr = useT();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const shells = useSettings((s) => s.shells);
  const appInfo = useSettings((s) => s.appInfo);

  const patch = <K extends Exclude<keyof AppSettings, "version">>(
    section: K,
    value: Partial<AppSettings[K]>,
  ) => update((s) => ({ ...s, [section]: { ...s[section], ...value } }));
  const terminalSettings = settings.terminal;
  const appDark = resolveTheme(settings.appearance.theme) === "dark";
  const scheme = getScheme(terminalSettings.colorScheme, appDark);
  const groups = Object.entries(
    Object.values(SHORTCUTS).reduce<Record<string, ShortcutDef[]>>((acc, d) => {
      (acc[d.group] ??= []).push(d);
      return acc;
    }, {}),
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={tr("Settings")}
        icon={<SlidersHorizontal />}
        description={tr("Changes are saved automatically.")}
      />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={tr("Settings sections")}
          className="w-48 shrink-0 space-y-0.5 border-r border-line p-3"
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(s.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-muted hover:bg-hover hover:text-fg [&_svg]:size-3.5"
            >
              {s.icon}
              {tr(s.label)}
            </a>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="max-w-3xl space-y-6 px-6 py-5">
            <Section id="appearance" title={tr("Appearance")} icon={<Palette />}>
              <Row label={tr("Language")}>
                <Select
                  aria-label={tr("Language")}
                  className="w-44"
                  value={settings.appearance.language}
                  onValueChange={(language) =>
                    patch("appearance", { language: language as UiLanguage })
                  }
                  options={[
                    { value: "english", label: tr("English") },
                    { value: "vietnamese", label: tr("Vietnamese") },
                  ]}
                />
              </Row>
              <Row label={tr("Theme")}>
                <Segmented<ThemeMode>
                  aria-label={tr("Theme")}
                  value={settings.appearance.theme}
                  onChange={(theme) => patch("appearance", { theme })}
                  options={[
                    { value: "dark", label: tr("Dark"), icon: <Moon /> },
                    { value: "light", label: tr("Light"), icon: <Sun /> },
                    { value: "system", label: tr("System"), icon: <Monitor /> },
                  ]}
                />
              </Row>
              <Row label={tr("Reduce motion")} hint={tr("Disables interface animations.")}>
                <Switch
                  aria-label={tr("Reduce motion")}
                  checked={settings.appearance.reduceMotion}
                  onCheckedChange={(v) => patch("appearance", { reduceMotion: v })}
                />
              </Row>
              <Row label={tr("Interface scale")}>
                <NumberField
                  label={tr("Interface scale")}
                  value={settings.appearance.uiScale}
                  min={80}
                  max={200}
                  suffix="%"
                  onCommit={(uiScale) => patch("appearance", { uiScale })}
                />
              </Row>
              <Row label={tr("Status bar")}>
                <Switch
                  aria-label={tr("Show status bar")}
                  checked={settings.layout.statusBarVisible}
                  onCheckedChange={(v) => patch("layout", { statusBarVisible: v })}
                />
              </Row>
            </Section>

            <Section id="terminal" title={tr("Terminal")} icon={<Terminal />}>
              <div className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-4">
                  <span className="text-[13px] text-fg">{tr("Color scheme")}</span>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <Switch
                      aria-label={tr("Match app theme")}
                      checked={terminalSettings.colorScheme === AUTO_SCHEME}
                      onCheckedChange={(v) =>
                        patch("terminal", { colorScheme: v ? AUTO_SCHEME : scheme.id })
                      }
                    />
                    {tr("Match app theme")}
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TERMINAL_SCHEMES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={scheme.id === s.id}
                      onClick={() => patch("terminal", { colorScheme: s.id })}
                      className={cn(
                        "overflow-hidden rounded-lg border border-line text-left transition-colors hover:border-line-strong",
                        scheme.id === s.id && "border-accent ring-1 ring-accent",
                        terminalSettings.colorScheme === AUTO_SCHEME &&
                          scheme.id !== s.id &&
                          "opacity-60",
                      )}
                    >
                      <div
                        className="px-2.5 py-2 font-mono text-[11px] leading-snug"
                        style={{ background: s.theme.background, color: s.theme.foreground }}
                      >
                        <span style={{ color: s.theme.green }}>user@host</span>:
                        <span style={{ color: s.theme.blue }}>~</span>$ ls
                        <br />
                        <span style={{ color: s.theme.cyan }}>app</span>{" "}
                        <span style={{ color: s.theme.yellow }}>logs</span>{" "}
                        <span style={{ color: s.theme.red }}>tmp</span>
                      </div>
                      <div className="bg-surface-2 px-2.5 py-1 text-[11px] text-muted">
                        {s.name}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <Row
                label={tr("Font family")}
                hint={tr("Any installed monospace font; comma-separated fallbacks.")}
              >
                <Input
                  aria-label={tr("Font family")}
                  defaultValue={terminalSettings.fontFamily}
                  className="w-80 font-mono text-xs"
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    patch("terminal", { fontFamily: e.target.value.trim() })
                  }
                />
              </Row>
              <Row label={tr("Font size")}>
                <NumberField
                  label={tr("Font size")}
                  value={terminalSettings.fontSize}
                  min={8}
                  max={40}
                  suffix="px"
                  onCommit={(fontSize) => patch("terminal", { fontSize })}
                />
              </Row>
              <Row label={tr("Line height")}>
                <NumberField
                  label={tr("Line height")}
                  value={terminalSettings.lineHeight}
                  min={1}
                  max={2.5}
                  step={0.05}
                  onCommit={(lineHeight) => patch("terminal", { lineHeight })}
                />
              </Row>
              <Row label={tr("Cursor")}>
                <div className="flex items-center gap-3">
                  <Segmented<CursorStyle>
                    aria-label={tr("Cursor style")}
                    value={terminalSettings.cursorStyle}
                    onChange={(cursorStyle) => patch("terminal", { cursorStyle })}
                    options={[
                      { value: "block", label: tr("Block") },
                      { value: "bar", label: tr("Bar") },
                      { value: "underline", label: tr("Underline") },
                    ]}
                  />
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <Switch
                      aria-label={tr("Blinking cursor")}
                      checked={terminalSettings.cursorBlink}
                      onCheckedChange={(cursorBlink) => patch("terminal", { cursorBlink })}
                    />
                    {tr("Blink")}
                  </label>
                </div>
              </Row>
              <Row label={tr("Scrollback")} hint={tr("Lines kept in memory per terminal.")}>
                <NumberField
                  label={tr("Scrollback")}
                  value={terminalSettings.scrollback}
                  min={0}
                  max={200000}
                  suffix="lines"
                  onCommit={(scrollback) => patch("terminal", { scrollback })}
                />
              </Row>
              <Row label={tr("Copy on select")}>
                <Switch
                  aria-label={tr("Copy on select")}
                  checked={terminalSettings.copyOnSelect}
                  onCheckedChange={(copyOnSelect) => patch("terminal", { copyOnSelect })}
                />
              </Row>
              <Row
                label={tr("Right-click pastes when no text is selected")}
                hint={tr("Right-click selected terminal text to open the action menu.")}
              >
                <Switch
                  aria-label={tr("Right-click pastes when no text is selected")}
                  checked={terminalSettings.rightClickPaste}
                  onCheckedChange={(rightClickPaste) => patch("terminal", { rightClickPaste })}
                />
              </Row>
              <Row
                label={tr("GPU acceleration")}
                hint={tr("WebGL renderer; falls back automatically if unavailable.")}
              >
                <Switch
                  aria-label={tr("GPU acceleration")}
                  checked={terminalSettings.webgl}
                  onCheckedChange={(webgl) => patch("terminal", { webgl })}
                />
              </Row>
              <Row label={tr("Terminal type")} hint={tr("Value of $TERM requested from servers.")}>
                <Input
                  aria-label={tr("Terminal type")}
                  defaultValue={terminalSettings.termType}
                  className="w-40 font-mono text-xs"
                  onBlur={(e) =>
                    /^[A-Za-z0-9._+-]{1,64}$/.test(e.target.value) &&
                    patch("terminal", { termType: e.target.value })
                  }
                />
              </Row>
              <div className="px-4 py-3">
                <div
                  className="rounded-md border border-line px-3 py-2"
                  style={{
                    background: scheme.theme.background,
                    color: scheme.theme.foreground,
                    fontFamily: terminalSettings.fontFamily,
                    fontSize: terminalSettings.fontSize,
                    lineHeight: terminalSettings.lineHeight,
                  }}
                >
                  {tr("Vietnamese sample: ă â đ ê ô ơ ư — Tiếng Việt có dấu.")} · 0O 1lI ✓ ═╗
                </div>
              </div>
            </Section>

            <Section id="ssh" title={tr("Connections")} icon={<SlidersHorizontal />}>
              <Row
                label={tr("Default connect timeout")}
                hint={tr("Used by Quick Connect and new profiles.")}
              >
                <NumberField
                  label={tr("Connect timeout")}
                  value={settings.ssh.connectTimeoutSecs}
                  min={1}
                  max={300}
                  suffix="s"
                  onCommit={(connectTimeoutSecs) => patch("ssh", { connectTimeoutSecs })}
                />
              </Row>
              <Row label={tr("Default keepalive interval")} hint={tr("0 disables keepalives.")}>
                <NumberField
                  label={tr("Keepalive interval")}
                  value={settings.ssh.keepaliveIntervalSecs}
                  min={0}
                  max={3600}
                  suffix="s"
                  onCommit={(keepaliveIntervalSecs) => patch("ssh", { keepaliveIntervalSecs })}
                />
              </Row>
              <Row label={tr("Default username")}>
                <Input
                  aria-label={tr("Default username")}
                  defaultValue={settings.ssh.defaultUsername}
                  placeholder="none"
                  className="w-48"
                  onBlur={(e) => patch("ssh", { defaultUsername: e.target.value.trim() })}
                />
              </Row>
              <Row label={tr("Default local shell")}>
                <Select
                  aria-label={tr("Default local shell")}
                  className="w-56"
                  value={settings.localTerminal.defaultShell ?? "__auto"}
                  onValueChange={(v) =>
                    patch("localTerminal", { defaultShell: v === "__auto" ? null : v })
                  }
                  options={[
                    { value: "__auto", label: tr("Automatic") },
                    ...shells.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </Row>
              <Row
                label={tr("Host key verification")}
                hint={tr("Unknown and changed host keys always require confirmation.")}
              >
                <span className="text-xs font-medium text-success">{tr("Always on")}</span>
              </Row>
            </Section>

            <Section id="safety" title={tr("Safety")} icon={<Shield />}>
              <Row
                label={tr("Confirm potentially destructive commands")}
                hint={tr("Applies to snippets and history (rm -rf, shutdown, DROP DATABASE…).")}
              >
                <Switch
                  aria-label={tr("Confirm potentially destructive commands")}
                  checked={settings.safety.confirmDestructiveSnippets}
                  onCheckedChange={(v) => patch("safety", { confirmDestructiveSnippets: v })}
                />
              </Row>
              <Row
                label={tr("Confirm multi-line paste")}
                hint={tr("Pasting several lines can run several commands.")}
              >
                <Switch
                  aria-label={tr("Confirm multi-line paste")}
                  checked={settings.safety.confirmMultilinePaste}
                  onCheckedChange={(v) => patch("safety", { confirmMultilinePaste: v })}
                />
              </Row>
              <Row label={tr("Confirm closing connected sessions")}>
                <Switch
                  aria-label={tr("Confirm closing connected sessions")}
                  checked={settings.safety.confirmCloseConnectedSession}
                  onCheckedChange={(v) => patch("safety", { confirmCloseConnectedSession: v })}
                />
              </Row>
            </Section>

            <Section id="shortcuts" title={tr("Keyboard shortcuts")} icon={<Keyboard />}>
              {groups.map(([group, defs]) => (
                <div key={group} className="px-4 py-3">
                  <div className="mb-2 text-xs font-medium text-muted">{tr(group)}</div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
                    {defs.map((d) => (
                      <div key={d.label} className="flex items-center justify-between text-[13px]">
                        <span className="text-fg">{tr(d.label)}</span>
                        <Kbd keys={d.keys} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="px-4 py-3 text-xs text-faint">
                {tr(
                  "Ctrl+C copies when text is selected and otherwise sends an interrupt. Ctrl+V and Shift+Insert paste.",
                )}
              </div>
            </Section>

            <Section id="about" title={tr("About")} icon={<Info />}>
              <Row label={tr("Version")}>
                <span className="font-mono text-xs text-muted">{appInfo?.version ?? "—"}</span>
              </Row>
              <Row label={tr("Database schema")}>
                <span className="font-mono text-xs text-muted">
                  v{appInfo?.schemaVersion ?? "—"}
                </span>
              </Row>
              <Row label={tr("Credential storage")}>
                <span className="text-xs text-muted">{appInfo?.credentialBackend ?? "—"}</span>
              </Row>
              <Row label={tr("Platform")}>
                <span className="text-xs text-muted">{appInfo?.platform ?? "—"}</span>
              </Row>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
