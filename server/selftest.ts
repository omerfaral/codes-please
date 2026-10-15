// End-to-end check: real hook script ↔ real server ↔ fake UI (WebSocket). `npm test`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { add, strip } from './install.ts';

const root = path.resolve(import.meta.dirname, '..');
const HOOK = path.join(root, 'hooks/booth-hook.cjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-test-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const token = 'test-token';
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port, token }));
const env = { ...process.env, BOOTH_HOME: home };

function hook(payload: object): { proc: ReturnType<typeof spawn>; out: Promise<{ code: number | null; stdout: string }> } {
  const proc = spawn('node', [HOOK], { env });
  let stdout = '';
  proc.stdout.on('data', (c) => (stdout += c));
  proc.stdin.end(JSON.stringify(payload));
  return { proc, out: new Promise((r) => proc.on('close', (code) => r({ code, stdout }))) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = { session_id: 's1', cwd: root, transcript_path: path.join(home, 'missing.jsonl'), permission_mode: 'default' };
const perm = (command: string) => ({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command } });

// 1) Server down → silent exit 0.
let r = await hook(perm('ls')).out;
assert.equal(r.code, 0);
assert.equal(r.stdout, '');

const server = spawn('node', ['--import', 'tsx', 'server/index.ts', '--no-open'], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise<void>((res) => server.stdout!.on('data', (c) => String(c).includes('on duty') && res()));

try {
  // 2) No UI open → no decision, falls back to the terminal prompt.
  r = await hook(perm('ls')).out;
  assert.equal(r.stdout, '');

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  let state: any;
  ws.on('message', (m) => {
    const msg = JSON.parse(String(m));
    if (msg.type === 'state') state = msg;
  });
  await new Promise((res) => ws.on('open', res));
  const waitQueue = async (n: number) => {
    for (let i = 0; i < 100 && state?.queue.length !== n; i++) await sleep(50);
    assert.equal(state.queue.length, n);
    return state.queue;
  };
  const decide = (appId: string, stamp: string, note?: string) => ws.send(JSON.stringify({ type: 'decide', appId, stamp, note }));

  // 3) APPROVE + note → allow; the note arrives via PostToolUse additionalContext.
  let h = hook(perm('npm test'));
  let [app] = await waitQueue(1);
  assert.equal(app.docs[0].kind, 'request');
  decide(app.id, 'approve', 'Skip the slow tests');
  r = await h.out;
  assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  r = await hook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 't1' }).out;
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Skip the slow tests/);

  // 4) DENY + note → deny message = the note.
  h = hook(perm('rm -rf /'));
  [app] = await waitQueue(1);
  decide(app.id, 'deny', 'Never');
  assert.equal(JSON.parse((await h.out).stdout).hookSpecificOutput.decision.message, 'Never');

  // 5) NOTE only → deny + instruction.
  h = hook(perm('git push -f'));
  [app] = await waitQueue(1);
  decide(app.id, 'note', 'Open a PR first');
  const d = JSON.parse((await h.out).stdout).hookSpecificOutput.decision;
  assert.equal(d.behavior, 'deny');
  assert.match(d.message, /Open a PR first/);

  // 6) Permanent → updatedPermissions scoped to the session.
  h = hook({ ...perm('npm run lint'), permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run lint' }], behavior: 'allow', destination: 'localSettings' }] });
  [app] = await waitQueue(1);
  decide(app.id, 'permanent');
  const up = JSON.parse((await h.out).stdout).hookSpecificOutput.decision.updatedPermissions;
  assert.equal(up[0].destination, 'session');

  // 7) Hook process killed (answered in the terminal) → application leaves the queue.
  h = hook(perm('sleep 1'));
  await waitQueue(1);
  h.proc.kill();
  await waitQueue(0);
  assert.equal(state.sessions[0].history.at(-1).stamp, 'terminal');

  // 8) Mailbox: Stop is blocked, then the PreToolUse path.
  ws.send(JSON.stringify({ type: 'mail', sessionId: 's1', text: 'Update the README too' }));
  await sleep(100);
  const stop = JSON.parse((await hook({ ...base, hook_event_name: 'Stop', stop_hook_active: false }).out).stdout);
  assert.equal(stop.decision, 'block');
  assert.match(stop.reason, /README/);
  assert.equal((await hook({ ...base, hook_event_name: 'Stop', stop_hook_active: true }).out).stdout, '');
  ws.send(JSON.stringify({ type: 'mail', sessionId: 's1', text: 'second' }));
  await sleep(100);
  r = await hook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, tool_use_id: 'x' }).out;
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /second/);

  // 9) Wrong token → 401 → silent exit.
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port, token: 'wrong' }));
  assert.equal((await hook(perm('ls')).out).stdout, '');
  ws.close();
} finally {
  server.kill();
}

// 10) Install touches only its own entries (including the legacy hook name).
const foreign = { hooks: { Stop: [{ matcher: '', hooks: [{ command: 'node other.js' }] }] }, model: 'x' };
const installed = add(structuredClone(foreign), '/x/booth-hook.cjs');
assert.equal(installed.hooks!.Stop.length, 2);
assert.ok(installed.hooks!.PermissionRequest);
installed.hooks!.Stop.push({ matcher: '', hooks: [{ command: 'node /old/kulube-hook.cjs' }] });
assert.deepEqual(strip(add(installed, '/x/booth-hook.cjs')), foreign);

console.log('✔ All checks passed');
process.exit(0);
