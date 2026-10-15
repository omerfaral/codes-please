// Agent-agnostic data model shared by the server and the web UI.

export type SessionStatus = 'working' | 'waiting' | 'idle' | 'closed';
export type Stamp = 'approve' | 'deny' | 'note' | 'permanent';

export interface HistoryEntry {
  at: number;
  tool: string;
  summary: string;
  stamp: Stamp | 'terminal';
  note?: string;
}

export interface Mail {
  id: string;
  text: string;
  at: number;
  deliveredAt?: number;
  via?: string;
}

export interface ChatLine {
  role: 'user' | 'assistant';
  text: string;
}

export interface Session {
  id: string;
  agent: string;
  name: string;
  title?: string;
  firstPrompt?: string;
  cwd: string;
  transcriptPath?: string;
  status: SessionStatus;
  color: string;
  lastSeen: number;
  history: HistoryEntry[];
  mailbox: Mail[];
  recent: ChatLine[];
}

export interface DiffLine {
  t: '+' | '-' | ' ';
  text: string;
  o?: number;
  n?: number;
}

export interface ResearchItem {
  tool: string;
  target: string;
  excerpt: string;
  links: string[];
}

export type Doc =
  | {
      kind: 'request';
      session: string;
      cwd: string;
      tool: string;
      target: string;
      mode: string;
      at: number;
    }
  | { kind: 'diff'; file: string; isNew: boolean; added: number; removed: number; lines: DiffLine[] }
  | { kind: 'research'; items: ResearchItem[] }
  | { kind: 'statement'; text: string };

export interface Application {
  id: string;
  sessionId: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  createdAt: number;
  docs: Doc[];
  canPersist: boolean;
}

export interface RuleSource {
  file: string;
  allow: string[];
  deny: string[];
  ask: string[];
}

export type ServerMsg =
  | { type: 'state'; sessions: Session[]; queue: Application[] }
  /** In demo mode, shows the output that would be sent to the agent. */
  | { type: 'log'; text: string };

export type ClientMsg =
  | { type: 'decide'; appId: string; stamp: Stamp; note?: string }
  | { type: 'mail'; sessionId: string; text: string }
  | { type: 'demo' };
