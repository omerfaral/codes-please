// Demo mode: generates fake hook events without a real Claude Code session.
// Events go through the real adapter; what would be sent to Claude shows up in the UI's radio log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { claude } from './adapters/claude.ts';
import type { Core } from './core.ts';

const ROOT = path.join(os.tmpdir(), 'booth-demo');

const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } });
const assistant = (...content: object[]) => ({ type: 'assistant', message: { role: 'assistant', content } });
const result = (id: string, content: string) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
});

interface Scenario {
  project: string;
  title?: string;
  prompt: string;
  files?: Record<string, string>;
  transcript: object[];
  tool: string;
  input: (dir: string) => Record<string, unknown>;
}

const SCENARIOS: Scenario[] = [
  {
    project: 'payment-service',
    prompt: 'Run the tests and fix the broken ones',
    transcript: [
      assistant({ type: 'text', text: "First I need to see the current test status. I'll run the whole suite with watch mode off so I can see every failing test in one go." }),
    ],
    tool: 'Bash',
    input: () => ({ command: 'npm test -- --watch=false', description: 'Run all tests' }),
  },
  {
    project: 'personal-blog',
    title: 'Add references to blog post',
    prompt: 'Add the official docs links to the Vite post',
    files: {
      'posts/vite.md': '# Getting started with Vite\n\nVite is a modern front-end build tool.\n\n## Install\n\nnpm create vite@latest\n\n## Verdict\n\nWorth a try.\n',
    },
    transcript: [
      assistant({ type: 'tool_use', id: 'ws1', name: 'WebSearch', input: { query: 'vite official guide getting started' } }),
      result('ws1', 'Getting Started | Vite https://vite.dev/guide/ — Vite is a build tool that aims to provide a faster and leaner development experience.\nWhy Vite https://vite.dev/guide/why.html'),
      assistant({ type: 'tool_use', id: 'wf1', name: 'WebFetch', input: { url: 'https://vite.dev/guide/', prompt: 'summarize' } }),
      result('wf1', 'Vite consists of two major parts: a dev server that serves native modules, and a build command that bundles code with Rollup.'),
      assistant({ type: 'text', text: 'Found the official guide. I\'ll add a "References" section at the end of the post with both links.' }),
    ],
    tool: 'Edit',
    input: (dir) => ({
      file_path: path.join(dir, 'posts/vite.md'),
      old_string: '## Verdict\n\nWorth a try.\n',
      new_string: '## Verdict\n\nWorth a try.\n\n## References\n\n- [Vite Guide](https://vite.dev/guide/)\n- [Why Vite?](https://vite.dev/guide/why.html)\n',
    }),
  },
  {
    project: 'data-pipeline',
    prompt: 'Write a module for the CSV converter',
    transcript: [
      assistant({ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/demo/data-pipeline/README.md' } }),
      result('r1', '# data-pipeline\nConverts daily sales CSV files to JSON.'),
      assistant({ type: 'text', text: 'Per the README, input is CSV and output is JSON. Creating a new module with a simple parser and no dependencies.' }),
    ],
    tool: 'Write',
    input: (dir) => ({
      file_path: path.join(dir, 'src/convert.ts'),
      content:
        Array.from({ length: 70 }, (_, i) =>
          i === 0 ? 'export function csvToJson(csv: string) {' : i === 69 ? '}' : `  // step ${i}: process rows`,
        ).join('\n') + '\n',
    }),
  },
  {
    project: 'payment-service',
    prompt: 'Clean the build folder',
    transcript: [assistant({ type: 'text', text: "Stale build output is causing conflicts; I'll delete the build folder entirely and rebuild." })],
    tool: 'Bash',
    input: () => ({ command: 'rm -rf build/ && npm run build', description: 'Clean build' }),
  },
];

const log = (core: Core, who: string, event: string, out: object | undefined) =>
  core.emit('log', `${who} · ${event} → ${out ? JSON.stringify(out) : '(no output: agent falls back to its default flow)'}`);

let mailTimer: NodeJS.Timeout | undefined;

export function runDemo(core: Core) {
  const ac = new AbortController();

  SCENARIOS.forEach((sc, i) => {
    setTimeout(async () => {
      const dir = path.join(ROOT, sc.project);
      const sessionId = 'demo-' + crypto.randomUUID().slice(0, 8);
      fs.mkdirSync(dir, { recursive: true });
      for (const [f, c] of Object.entries(sc.files ?? {})) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.writeFileSync(path.join(dir, f), c);
      }
      const transcript = path.join(ROOT, sessionId + '.jsonl');
      const entries = [user(sc.prompt), ...(sc.title ? [{ type: 'ai-title', aiTitle: sc.title }] : []), ...sc.transcript];
      fs.writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const base = { session_id: sessionId, cwd: dir, transcript_path: transcript, permission_mode: 'default' };
      const input = sc.input(dir);
      const call = (event: string, extra: object = {}) =>
        claude.handle(event, { ...base, hook_event_name: event, ...extra }, core, ac.signal);

      await call('SessionStart', { source: 'startup' });
      await call('UserPromptSubmit', { prompt: sc.prompt });
      await call('PreToolUse', { tool_name: sc.tool, tool_input: input, tool_use_id: 'toolu_' + i });
      const decision = await call('PermissionRequest', { tool_name: sc.tool, tool_input: input });
      const who = core.sessions.get(sessionId)?.name ?? sessionId;
      log(core, who, 'PermissionRequest', decision);
      if ((decision as any)?.hookSpecificOutput?.decision?.behavior === 'allow') {
        const post = { tool_name: sc.tool, tool_input: input, tool_use_id: 'toolu_' + i, tool_response: {} };
        log(core, who, 'PostToolUse', await call('PostToolUse', post));
      }
      log(core, who, 'Stop', await call('Stop', { stop_hook_active: false }));
    }, 600 + i * 2500);
  });

  // Mail written to an idle demo session is delivered on its next "Stop".
  clearInterval(mailTimer);
  mailTimer = setInterval(async () => {
    for (const s of core.sessions.values()) {
      if (!s.id.startsWith('demo-') || !s.mailbox.some((m) => !m.deliveredAt)) continue;
      const p = { session_id: s.id, cwd: s.cwd, transcript_path: s.transcriptPath, stop_hook_active: false };
      log(core, s.name, 'Stop (mail)', await claude.handle('Stop', p, core, ac.signal));
      setTimeout(() => core.touch({ agent: 'claude', sessionId: s.id, status: 'input' }), 3000);
    }
  }, 5000);
}
