#!/usr/bin/env node
// Command-line entry point: `codes-please [start|demo|install|uninstall]`.
import pkg from '../package.json' with { type: 'json' };
import { startServer } from './index.ts';
import { run } from './install.ts';

const HELP = `Codes, Please ${pkg.version} — a Papers, Please-style checkpoint for Claude Code

Usage: codes-please [command] [--no-open]

Commands:
  start       Open the booth (default)
  demo        Open the booth with fake applicants, no Claude Code needed
  install     Add the hooks to ~/.claude/settings.json (a backup is made first)
  uninstall   Remove only this tool's hooks from ~/.claude/settings.json
`;

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('-')) ?? 'start';
const open = !args.includes('--no-open');

if (args.includes('--version') || args.includes('-v')) console.log(pkg.version);
else if (args.includes('--help') || args.includes('-h') || cmd === 'help') console.log(HELP);
else if (cmd === 'start' || cmd === 'demo') startServer({ demo: cmd === 'demo', open });
else if (cmd === 'install' || cmd === 'uninstall') run(cmd);
else {
  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  process.exit(1);
}
