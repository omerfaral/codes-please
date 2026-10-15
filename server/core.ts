// Agent-agnostic core: sessions, application queue, decisions, note queue, mailbox, documents.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { structuredPatch } from 'diff';
import { analyzeTranscript, summarize, type TranscriptInfo } from './transcript.ts';
import type { Application, DiffLine, Doc, ServerMsg, Session, SessionStatus, Stamp } from './types.ts';

export const HOME = process.env.BOOTH_HOME || path.join(os.homedir(), '.checkpoint-booth');

export function loadConfig(): { port: number; token: string } {
  const file = path.join(HOME, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const cfg = { port: Number(process.env.BOOTH_PORT) || 4777, token: crypto.randomBytes(32).toString('hex') };
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    return cfg;
  }
}

const COLORS = ['#9b5d43', '#4f7a5c', '#56709c', '#a08638', '#86557a', '#3d7d80', '#9c4a4a', '#6f7146'];
const UI_GONE_GRACE_MS = 15_000;
const DISCOVER_DAYS = 7;
const DISCOVER_EVERY_MS = 60_000;
const LIVE_POLL_MS = 2_000;

export const PROJECTS_DIR =
  process.env.BOOTH_PROJECTS_DIR || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');

export interface PermissionInput {
  agent: string;
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  permissionMode?: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface Decision {
  stamp: Stamp;
  note?: string;
}

export interface TouchInput {
  agent: string;
  sessionId: string;
  cwd?: string;
  transcriptPath?: string;
  status?: SessionStatus;
  title?: string;
  prompt?: string;
  refresh?: boolean;
}

const short = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};

function applyEdit(src: string, oldS: string, newS: string, all?: boolean): string | undefined {
  if (!oldS) return src ? undefined : newS;
  if (all) return src.includes(oldS) ? src.split(oldS).join(newS) : undefined;
  const i = src.indexOf(oldS);
  return i < 0 ? undefined : src.slice(0, i) + newS + src.slice(i + oldS.length);
}

function diffLines(a: string, b: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const h of structuredPatch('a', 'b', a, b, '', '', { context: 3 }).hunks) {
    if (out.length) out.push({ t: ' ', text: '⋯' });
    let o = h.oldStart;
    let n = h.newStart;
    for (const l of h.lines) {
      const t = l[0] as DiffLine['t'];
      if (t !== '+' && t !== '-' && t !== ' ') continue; // "\ No newline at end of file"
      out.push({ t, text: l.slice(1), o: t === '+' ? undefined : o, n: t === '-' ? undefined : n });
      if (t !== '+') o++;
      if (t !== '-') n++;
    }
    if (out.length > 5000) break; // ponytail: huge diffs are truncated; add server-side paging if needed
  }
  return out;
}

export function diffDoc(tool: string, input: Record<string, any>): Extract<Doc, { kind: 'diff' }> | undefined {
  const file = input.file_path;
  if (typeof file !== 'string' || !['Edit', 'Write', 'MultiEdit'].includes(tool)) return;
  let current = '';
  let exists = false;
  try {
    if (fs.statSync(file).size < 3_000_000) {
      current = fs.readFileSync(file, 'utf8');
      exists = true;
    }
  } catch {}
  let next: string | undefined;
  if (tool === 'Write') next = String(input.content ?? '');
  else if (tool === 'Edit') next = applyEdit(current, input.old_string ?? '', input.new_string ?? '', input.replace_all);
  else
    next = (input.edits ?? []).reduce(
      (s: string | undefined, e: any) => (s === undefined ? s : applyEdit(s, e.old_string ?? '', e.new_string ?? '', e.replace_all)),
      current,
    );
  // If the old text isn't in the file, at least diff the fragments.
  const lines =
    next === undefined
      ? diffLines(
          tool === 'MultiEdit' ? (input.edits ?? []).map((e: any) => e.old_string).join('\n') : String(input.old_string ?? ''),
          tool === 'MultiEdit' ? (input.edits ?? []).map((e: any) => e.new_string).join('\n') : String(input.new_string ?? ''),
        )
      : diffLines(current, next);
  return {
    kind: 'diff',
    file,
    isNew: !exists,
    added: lines.filter((l) => l.t === '+').length,
    removed: lines.filter((l) => l.t === '-').length,
    lines,
  };
}

export class Core extends EventEmitter {
  sessions = new Map<string, Session>();
  pending = new Map<string, { app: Application; resolve: (d: Decision | null) => void }>();
  private toolNotes: { sessionId: string; key: string; note: string }[] = [];
  private clients = 0;
  private uiGoneTimer?: NodeJS.Timeout;
  private saveTimer?: NodeJS.Timeout;
  private transcriptMtimes = new Map<string, number>();

  constructor(private stateFile = path.join(HOME, 'state.json')) {
    super();
    try {
      const weekAgo = Date.now() - 7 * 86400_000;
      for (const s of JSON.parse(fs.readFileSync(stateFile, 'utf8')).sessions as Session[])
        if (s.lastSeen > weekAgo) this.sessions.set(s.id, { ...s, status: s.status === 'closed' ? 'closed' : 'idle' });
    } catch {}
  }

  snapshot(): ServerMsg {
    const sessions = [...this.sessions.values()].map((s) => ({
      ...s,
      status: [...this.pending.values()].some((p) => p.app.sessionId === s.id) ? ('waiting' as const) : s.status,
    }));
    sessions.sort((a, b) => b.lastSeen - a.lastSeen);
    const queue = [...this.pending.values()].map((p) => p.app).sort((a, b) => a.createdAt - b.createdAt);
    return { type: 'state', sessions, queue };
  }

  private changed() {
    this.emit('change');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
        fs.writeFileSync(this.stateFile, JSON.stringify({ sessions: [...this.sessions.values()] }));
      } catch {}
    }, 500);
  }

  /** Begins discovering on-disk sessions and following their transcripts live. */
  start(projectsDir = PROJECTS_DIR) {
    this.discover(projectsDir);
    setInterval(() => this.discover(projectsDir), DISCOVER_EVERY_MS).unref();
    setInterval(() => this.followTranscripts(), LIVE_POLL_MS).unref();
  }

  private newSession(id: string, agent: string, cwd: string): Session {
    const hash = crypto.createHash('md5').update(id).digest()[0];
    const s: Session = {
      id,
      agent,
      name: '',
      cwd,
      status: 'idle',
      color: COLORS[hash % COLORS.length],
      lastSeen: Date.now(),
      history: [],
      mailbox: [],
      recent: [],
    };
    this.sessions.set(id, s);
    return s;
  }

  private applyInfo(s: Session, info: TranscriptInfo) {
    if (info.title) s.title = info.title;
    if (info.firstPrompt && !s.firstPrompt) s.firstPrompt = info.firstPrompt;
    if (info.cwd && !s.cwd) s.cwd = info.cwd;
    if (info.recent.length) s.recent = info.recent;
    s.activity = info.activity;
  }

  private rename(s: Session) {
    const dir = path.basename(s.cwd || '') || s.id.slice(0, 8);
    s.name = s.title || (s.firstPrompt ? `${dir} · ${short(s.firstPrompt, 40)}` : dir);
  }

  /** Lists Claude Code sessions found on disk, including ones that never fired a hook (e.g. started before install). */
  discover(dir = PROJECTS_DIR) {
    const since = Date.now() - DISCOVER_DAYS * 86400_000;
    let found = false;
    let projects: string[] = [];
    try {
      projects = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const project of projects) {
      let files: string[] = [];
      try {
        files = fs.readdirSync(path.join(dir, project)).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const id = f.slice(0, -'.jsonl'.length);
        if (this.sessions.has(id)) continue;
        const file = path.join(dir, project, f);
        let mtime: number;
        try {
          mtime = fs.statSync(file).mtimeMs;
        } catch {
          continue;
        }
        if (mtime < since) continue;
        const info = analyzeTranscript(file, true, 128_000);
        if (!info.firstPrompt && !info.title) continue; // empty or aborted session
        const s = this.newSession(id, 'claude', info.cwd ?? '');
        s.transcriptPath = file;
        s.lastSeen = mtime;
        s.status = Date.now() - mtime < 3600_000 ? 'idle' : 'closed';
        this.applyInfo(s, info);
        this.rename(s);
        this.transcriptMtimes.set(id, mtime);
        found = true;
      }
    }
    if (found) this.changed();
  }

  /** Re-reads transcripts that changed since the last poll so folders show the agent's progress live. */
  private followTranscripts() {
    let changed = false;
    for (const s of this.sessions.values()) {
      if (!s.transcriptPath) continue;
      let mtime: number;
      try {
        mtime = fs.statSync(s.transcriptPath).mtimeMs;
      } catch {
        continue;
      }
      const prev = this.transcriptMtimes.get(s.id);
      this.transcriptMtimes.set(s.id, mtime);
      if (prev === undefined || prev === mtime) continue;
      this.applyInfo(s, analyzeTranscript(s.transcriptPath, !s.firstPrompt, 256_000));
      this.rename(s);
      s.lastSeen = Math.max(s.lastSeen, mtime);
      // A transcript growing without hooks telling us means the session was resumed or predates the install.
      if (s.status === 'closed' || s.status === 'idle') s.status = 'working';
      changed = true;
    }
    if (changed) this.changed();
  }

  touch(p: TouchInput, info?: TranscriptInfo): Session {
    const s = this.sessions.get(p.sessionId) ?? this.newSession(p.sessionId, p.agent, p.cwd ?? '');
    s.lastSeen = Date.now();
    if (p.cwd) s.cwd = p.cwd;
    if (p.transcriptPath) s.transcriptPath = p.transcriptPath;
    if (p.status) s.status = p.status;
    if (p.title) s.title = p.title;
    if (p.prompt && !s.firstPrompt) s.firstPrompt = p.prompt;
    if (p.refresh && !info) info = analyzeTranscript(s.transcriptPath, !s.firstPrompt);
    if (info) this.applyInfo(s, info);
    this.rename(s);
    this.changed();
    return s;
  }

  setClients(n: number) {
    this.clients = n;
    clearTimeout(this.uiGoneTimer);
    // UI gone → release pending requests so Claude Code falls back to its terminal prompt.
    if (n === 0 && this.pending.size)
      this.uiGoneTimer = setTimeout(() => {
        for (const id of [...this.pending.keys()]) this.release(id, null, 'terminal');
      }, UI_GONE_GRACE_MS);
  }

  private release(appId: string, d: Decision | null, stamp: Stamp | 'terminal') {
    const p = this.pending.get(appId);
    if (!p) return;
    this.pending.delete(appId);
    const s = this.sessions.get(p.app.sessionId);
    s?.history.push({ at: Date.now(), tool: p.app.tool, summary: p.app.summary, stamp, note: d?.note || undefined });
    if (s && s.history.length > 200) s.history.splice(0, s.history.length - 200);
    p.resolve(d);
    this.changed();
  }

  /** Waits for a human decision. null = no decision; the agent should use its default flow. */
  requestPermission(p: PermissionInput, signal?: AbortSignal): Promise<Decision | null> {
    if (this.clients === 0 || signal?.aborted) return Promise.resolve(null);
    const info = analyzeTranscript(p.transcriptPath, true);
    const s = this.touch({ agent: p.agent, sessionId: p.sessionId, cwd: p.cwd, transcriptPath: p.transcriptPath }, info);
    const summary = summarize(p.tool, p.input);
    const docs: Doc[] = [
      { kind: 'request', session: s.name, cwd: p.cwd, tool: p.tool, target: summary, mode: p.permissionMode ?? '-', at: Date.now() },
    ];
    try {
      const d = diffDoc(p.tool, p.input);
      if (d && d.lines.length) docs.push(d);
    } catch {}
    if (info.statement) docs.push({ kind: 'statement', text: info.statement });
    if (info.research.length) docs.push({ kind: 'research', items: info.research });

    const app: Application = {
      id: crypto.randomUUID(),
      sessionId: p.sessionId,
      tool: p.tool,
      input: p.input,
      summary,
      createdAt: Date.now(),
      docs,
      canPersist: true,
    };
    return new Promise((resolve) => {
      this.pending.set(app.id, { app, resolve });
      signal?.addEventListener('abort', () => this.release(app.id, null, 'terminal'), { once: true });
      this.changed();
      this.emit('application', app);
    });
  }

  decide(appId: string, d: Decision) {
    const p = this.pending.get(appId);
    if (!p) return;
    if (d.stamp === 'note' && !d.note?.trim()) return; // a NOTE stamp needs a note
    if ((d.stamp === 'approve' || d.stamp === 'permanent') && d.note?.trim())
      this.toolNotes.push({ sessionId: p.app.sessionId, key: p.app.tool + JSON.stringify(p.app.input), note: d.note.trim() });
    this.release(appId, d, d.stamp);
  }

  /** Note attached to an approved request; delivered once, after the tool has run. */
  takeToolNote(sessionId: string, tool: string, input: unknown): string | undefined {
    const key = tool + JSON.stringify(input);
    const i = this.toolNotes.findIndex((n) => n.sessionId === sessionId && n.key === key);
    if (i < 0) return;
    return this.toolNotes.splice(i, 1)[0].note;
  }

  postMail(sessionId: string, text: string) {
    const s = this.sessions.get(sessionId);
    if (!s || !text.trim()) return;
    s.mailbox.push({ id: crypto.randomUUID(), text: text.trim(), at: Date.now() });
    if (s.mailbox.length > 30) s.mailbox.splice(0, s.mailbox.length - 30);
    this.changed();
  }

  /** Marks all waiting mail as delivered and returns it as one text. */
  takeMail(sessionId: string, via: string): string | undefined {
    const s = this.sessions.get(sessionId);
    const waiting = s?.mailbox.filter((m) => !m.deliveredAt) ?? [];
    if (!waiting.length) return;
    const now = Date.now();
    for (const m of waiting) Object.assign(m, { deliveredAt: now, via });
    this.changed();
    return waiting.map((m) => m.text).join('\n\n');
  }
}
