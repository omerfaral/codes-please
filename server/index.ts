// Checkpoint Booth local server: hook endpoints (long-poll), WebSocket, rule book, static UI.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocketServer, type WebSocket } from 'ws';
import { Core, loadConfig } from './core.ts';
import { claude, type Adapter } from './adapters/claude.ts';
import { runDemo } from './demo.ts';
import type { ClientMsg, RuleSource, ServerMsg } from './types.ts';

const ADAPTERS: Record<string, Adapter> = { claude };
const DIST = path.resolve(import.meta.dirname, '../dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
};

const cfg = loadConfig();
const core = new Core();
const args = process.argv.slice(2);

const tokenOf = (req: http.IncomingMessage, u: URL) =>
  (req.headers.authorization ?? '').replace(/^Bearer /, '') || u.searchParams.get('token') || '';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 20_000_000) req.destroy(new Error('body too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function rules(cwd: string): RuleSource[] {
  const files = [path.join(os.homedir(), '.claude', 'settings.json')];
  if (cwd) files.push(path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json'));
  return files.flatMap((file) => {
    try {
      const p = JSON.parse(fs.readFileSync(file, 'utf8')).permissions ?? {};
      return [{ file, allow: p.allow ?? [], deny: p.deny ?? [], ask: p.ask ?? [] }];
    } catch {
      return [];
    }
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://127.0.0.1');
  const json = (code: number, body?: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  if (u.pathname.startsWith('/hook/') || u.pathname.startsWith('/api/')) {
    if (tokenOf(req, u) !== cfg.token) return json(401, { error: 'unauthorized' });
  }

  // POST /hook/<agent>/<event> — the hook script connects here; PermissionRequest stays open until decided.
  const m = u.pathname.match(/^\/hook\/([\w-]+)\/([\w-]+)$/);
  if (m && req.method === 'POST') {
    const adapter = ADAPTERS[m[1]];
    if (!adapter) return json(404);
    const ac = new AbortController();
    // Hook process died (e.g. the user answered in the terminal) → drop the application from the queue.
    res.on('close', () => !res.writableFinished && ac.abort());
    let out: object | undefined;
    try {
      out = await adapter.handle(decodeURIComponent(m[2]), JSON.parse(await readBody(req)), core, ac.signal);
    } catch (e) {
      console.error('[hook]', e);
    }
    if (res.destroyed) return;
    if (!out) {
      res.writeHead(204);
      return res.end();
    }
    return json(200, out);
  }

  if (u.pathname === '/api/rules') return json(200, rules(u.searchParams.get('cwd') ?? ''));

  // Static UI (vite build output).
  const file = path.resolve(DIST, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
  const target = file.startsWith(DIST + path.sep) && fs.existsSync(file) ? file : path.join(DIST, 'index.html');
  if (!fs.existsSync(target)) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('UI not built: run `npm run build` first.');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});

const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ req }: { req: http.IncomingMessage }) => tokenOf(req, new URL(req.url ?? '/', 'http://127.0.0.1')) === cfg.token,
});

const send = (ws: WebSocket, msg: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
const broadcast = (msg: ServerMsg) => wss.clients.forEach((ws) => send(ws, msg));

let scheduled = false;
core.on('change', () => {
  if (scheduled) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    broadcast(core.snapshot());
  });
});
core.on('log', (text: string) => broadcast({ type: 'log', text }));

let demoStarted = false;
wss.on('connection', (ws) => {
  core.setClients(wss.clients.size);
  send(ws, core.snapshot());
  if (args.includes('--demo') && !demoStarted) {
    demoStarted = true;
    runDemo(core);
  }
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'decide') core.decide(msg.appId, { stamp: msg.stamp, note: msg.note });
    else if (msg.type === 'mail') core.postMail(msg.sessionId, String(msg.text ?? '').slice(0, 20_000));
    else if (msg.type === 'demo') runDemo(core);
  });
  ws.on('close', () => core.setClients(wss.clients.size));
});

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${cfg.port} is in use. The booth may already be running.` : e);
  process.exit(1);
});

server.listen(cfg.port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${cfg.port}/?token=${cfg.token}`;
  console.log(`\n  CHECKPOINT BOOTH is on duty.\n  ${url}\n`);
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
});
