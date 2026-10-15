// Install/uninstall: backs up ~/.claude/settings.json and adds/removes only Checkpoint Booth hook entries.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './core.ts';

const MARKER = 'booth-hook.cjs';
const LEGACY_MARKERS = ['kulube-hook.cjs']; // earlier name of the hook script
const HOOK = path.resolve(import.meta.dirname, '../hooks', MARKER);
const SETTINGS = process.env.BOOTH_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');

// Seconds. PermissionRequest waits for a human decision; the others return immediately.
const EVENTS: Record<string, number> = {
  PermissionRequest: 86400,
  PreToolUse: 10,
  PostToolUse: 10,
  Stop: 10,
  UserPromptSubmit: 10,
  SessionStart: 10,
  SessionEnd: 10,
};

type Settings = { hooks?: Record<string, { matcher?: string; hooks: { command?: string }[] }[]> };

const isOurs = (h: { command?: string }) => [MARKER, ...LEGACY_MARKERS].some((m) => h.command?.includes(m));

export function strip(s: Settings): Settings {
  for (const [event, groups] of Object.entries(s.hooks ?? {})) {
    const kept = groups
      .map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length);
    if (kept.length) s.hooks![event] = kept;
    else delete s.hooks![event];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

export function add(s: Settings, hookPath = HOOK): Settings {
  strip(s);
  s.hooks ??= {};
  for (const [event, timeout] of Object.entries(EVENTS)) {
    (s.hooks[event] ??= []).push({ matcher: '', hooks: [{ type: 'command', command: `node "${hookPath}"`, timeout } as any] });
  }
  return s;
}

function main(cmd: string) {
  let raw = '{}';
  try {
    raw = fs.readFileSync(SETTINGS, 'utf8');
  } catch {}
  const settings: Settings = JSON.parse(raw);
  if (raw !== '{}') {
    const backup = `${SETTINGS}.booth-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(SETTINGS, backup);
    console.log('Backup:', backup);
  }
  if (cmd === 'install') {
    loadConfig(); // create the access token on first install
    add(settings);
  } else if (cmd === 'uninstall') strip(settings);
  else {
    console.log('Usage: install | uninstall');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  console.log(cmd === 'install' ? `Hooks added (${Object.keys(EVENTS).join(', ')}).` : 'Checkpoint Booth hooks removed.');
  console.log('For already-open Claude Code sessions, open and close the /hooks menu or restart the session.');
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) main(process.argv[2]);
