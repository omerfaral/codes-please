// Claude Code transcript (JSONL) reader: title, first prompt, latest statement, research summaries, recent messages.
import fs from 'node:fs';
import type { ChatLine, ResearchItem } from './types.ts';

type Entry = Record<string, any>;

function readSlice(file: string, fromEnd: boolean, bytes: number): Entry[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, fromEnd ? size - len : 0);
    const lines = buf.toString('utf8').split('\n');
    // Drop the partial line cut off by the slice.
    if (fromEnd && len < size) lines.shift();
    if (!fromEnd && len < size) lines.pop();
    const out: Entry[] = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        out.push(JSON.parse(l));
      } catch {}
    }
    return out;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const blocks = (e: Entry): any[] => {
  const c = e.message?.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
};

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((b) => (typeof b === 'string' ? b : b?.type === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  return '';
};

// Is this a real user prompt (not a tool result, meta entry or command output)?
function promptText(e: Entry): string | undefined {
  if (e.type !== 'user' || e.isMeta || e.isSidechain) return;
  const bs = blocks(e);
  if (bs.some((b) => b.type === 'tool_result')) return;
  const t = bs
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!t || t.startsWith('<')) return;
  return t;
}

const LINK_RE = /https?:\/\/[^\s"'<>)\]]+/g;

/** One-line description of a tool call: its command, file, URL or query. */
export function summarize(tool: string, input: Record<string, any>): string {
  const v = input.command ?? input.file_path ?? input.notebook_path ?? input.url ?? input.query ?? input.pattern ?? input.description;
  return String(v ?? JSON.stringify(input)).slice(0, 300);
}

export interface TranscriptInfo {
  title?: string;
  firstPrompt?: string;
  statement?: string;
  research: ResearchItem[];
  recent: ChatLine[];
  /** Latest tool call, shown as live activity while the agent works. */
  activity?: string;
  cwd?: string;
}

/** `tailBytes` keeps periodic and discovery scans cheap; permission requests read more for full documents. */
export function analyzeTranscript(file: string | undefined, wantFirstPrompt = false, tailBytes = 1_500_000): TranscriptInfo {
  const info: TranscriptInfo = { research: [], recent: [] };
  if (!file) return info;
  const tail = readSlice(file, true, tailBytes);

  // Current turn = everything after the last real user prompt.
  let turnStart = 0;
  for (let i = tail.length - 1; i >= 0; i--) {
    if (promptText(tail[i])) {
      turnStart = i;
      break;
    }
  }

  const results = new Map<string, unknown>();
  for (const e of tail) {
    if (e.cwd && !info.cwd) info.cwd = e.cwd;
    if (e.type === 'ai-title' && e.aiTitle) info.title = e.aiTitle;
    if (e.type === 'custom-title' && e.customTitle) info.title = e.customTitle;
    if (e.type === 'summary' && e.summary && !info.title) info.title = e.summary;
    if (e.type === 'user') for (const b of blocks(e)) if (b.type === 'tool_result') results.set(b.tool_use_id, b.content);
  }

  for (let i = turnStart; i < tail.length; i++) {
    const e = tail[i];
    if (e.type !== 'assistant' || e.isSidechain) continue;
    for (const b of blocks(e)) {
      if (b.type === 'text' && b.text?.trim()) info.statement = b.text.trim();
      if (b.type === 'tool_use' && ['WebSearch', 'WebFetch', 'Read'].includes(b.name)) {
        const inp = b.input ?? {};
        const target = inp.query ?? inp.url ?? inp.file_path ?? '';
        const res = textOf(results.get(b.id));
        const links = [...new Set([...(inp.url ? [inp.url] : []), ...(res.match(LINK_RE) ?? [])])].slice(0, 8);
        info.research.push({ tool: b.name, target: String(target), excerpt: res.trim().slice(0, 600), links });
      }
    }
  }
  info.research = info.research.slice(-8);

  for (const e of tail) {
    const p = promptText(e);
    if (p) info.recent.push({ role: 'user', text: p.slice(0, 500) });
    else if (e.type === 'assistant' && !e.isSidechain) {
      for (const b of blocks(e)) {
        if (b.type === 'text' && b.text?.trim()) info.recent.push({ role: 'assistant', text: b.text.trim().slice(0, 500) });
        if (b.type === 'tool_use') info.recent.push({ role: 'tool', text: `${b.name} ${summarize(b.name, b.input ?? {})}`.slice(0, 200) });
      }
    }
  }
  info.recent = info.recent.slice(-30);
  const last = info.recent.at(-1);
  if (last?.role === 'tool') info.activity = last.text;

  if (wantFirstPrompt) {
    for (const e of readSlice(file, false, 256_000)) {
      const p = promptText(e);
      if (p) {
        info.firstPrompt = p;
        break;
      }
    }
  }
  return info;
}
