import '@fontsource/pixelify-sans/400.css';
import '@fontsource/vt323/400.css';
import './style.css';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Application, ClientMsg, ServerMsg, Session, Stamp } from '../../server/types.ts';
import { Plaza, Portrait, lookFor, type Walker } from './scene.tsx';
import { Desk } from './desk.tsx';
import { Cabinet, Folder, RuleBook } from './cabinet.tsx';
import { I18n, LANGS, type Lang } from './i18n.ts';

// ── Access token: taken from the URL, then removed from the address bar ──
function getToken() {
  const u = new URL(location.href);
  const t = u.searchParams.get('token');
  if (t) {
    try {
      localStorage.setItem('booth-token', t);
    } catch {}
    u.searchParams.delete('token');
    history.replaceState(null, '', u.pathname + u.search);
    return t;
  }
  try {
    return localStorage.getItem('booth-token') ?? '';
  } catch {
    return '';
  }
}
const TOKEN = getToken();

// ── Settings ──
interface Settings {
  crt: boolean;
  sound: boolean;
  notify: boolean;
  lang: Lang;
}
const DEFAULT_SETTINGS: Settings = { crt: true, sound: true, notify: false, lang: 'en' };
function loadSettings(): Settings {
  try {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('booth-settings') ?? '{}') };
    return s.lang in LANGS ? s : { ...s, lang: 'en' };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ── Sound effects (synthesised with WebAudio, no files) ──
let actx: AudioContext | undefined;
function noise(ac: AudioContext, dur: number, type: BiquadFilterType, freq: number, gain: number) {
  const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = ac.createBufferSource();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = buf;
  f.type = type;
  f.frequency.value = freq;
  g.gain.value = gain;
  src.connect(f).connect(g).connect(ac.destination);
  src.start();
}
function tone(ac: AudioContext, freq: number, dur: number, gain: number, at = 0, endFreq?: number) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  const t = ac.currentTime + at;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur);
}
const SFX = {
  stamp: (ac: AudioContext) => {
    tone(ac, 140, 0.16, 0.7, 0, 45);
    noise(ac, 0.07, 'lowpass', 900, 0.8);
  },
  paper: (ac: AudioContext) => noise(ac, 0.28, 'bandpass', 2600, 0.35),
  // Page flip: a quick bright swish followed by a soft landing.
  page: (ac: AudioContext) => {
    noise(ac, 0.12, 'highpass', 3800, 0.3);
    setTimeout(() => noise(ac, 0.09, 'bandpass', 1400, 0.25), 70);
  },
  bell: (ac: AudioContext) => {
    tone(ac, 1046, 1.1, 0.18);
    tone(ac, 1568, 0.7, 0.06);
    tone(ac, 784, 1.3, 0.16, 0.28);
  },
};

// ── Server connection ──
function useServer() {
  const [state, setState] = useState<{ sessions: Session[]; queue: Application[] }>({ sessions: [], queue: [] });
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const ws = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (!TOKEN) return;
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${TOKEN}`);
      ws.current = s;
      s.onopen = () => setConnected(true);
      s.onmessage = (e) => {
        const m = JSON.parse(e.data) as ServerMsg;
        if (m.type === 'state') setState({ sessions: m.sessions, queue: m.queue });
        else setLogs((l) => [...l.slice(-40), m.text]);
      };
      s.onclose = () => {
        setConnected(false);
        if (!stop) retry = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, []);
  const send = useCallback((m: ClientMsg) => ws.current?.send(JSON.stringify(m)), []);
  return { ...state, connected, logs, send };
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function App() {
  const { sessions, queue, connected, logs, send } = useServer();
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [ink, setInk] = useState<Stamp | null>(null);
  const [note, setNote] = useState('');
  const [noteShake, setNoteShake] = useState(false);
  const [shake, setShake] = useState(false);
  const [leaving, setLeaving] = useState<{ w: Walker; passed: boolean } | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const t = LANGS[settings.lang];

  const sById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const current = queue.find((a) => a.id === currentId) ?? null;
  const currentSession = current ? sById.get(current.sessionId) : undefined;
  const waiting = queue.filter((a) => a.id !== currentId);
  const walker = (a: Application): Walker => ({ id: a.id, look: lookFor(a.sessionId, sById.get(a.sessionId)?.color ?? '#6f7146') });

  const play = useCallback(
    (k: keyof typeof SFX) => {
      if (!settings.sound) return;
      try {
        SFX[k]((actx ??= new AudioContext()));
      } catch {}
    },
    [settings.sound],
  );

  useEffect(() => {
    try {
      localStorage.setItem('booth-settings', JSON.stringify(settings));
    } catch {}
    document.documentElement.lang = settings.lang;
  }, [settings]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The application was closed elsewhere (answered in the terminal, timed out) → clear the desk.
  useEffect(() => {
    if (currentId && !current) {
      setCurrentId(null);
      setInk(null);
    }
  }, [currentId, current]);

  // New application notification + tab title
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const a of queue) {
      if (seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      if (settings.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted')
        new Notification(t.newApplication, { body: `${sById.get(a.sessionId)?.name ?? ''}: ${a.tool} — ${a.summary}`.slice(0, 180), tag: a.id });
    }
    document.title = queue.length ? `(${queue.length}) ${t.appName}` : t.appName;
  }, [queue, settings.notify, sById, t]);

  const callNext = () => {
    if (current || !waiting.length) return;
    play('bell');
    setCurrentId(waiting[0].id);
    setInk(null);
    setNote('');
    setTimeout(() => play('paper'), 450);
  };

  const shakeNote = () => {
    setNoteShake(true);
    setTimeout(() => setNoteShake(false), 450);
    noteRef.current?.focus();
  };

  const stamp = (s: Stamp) => {
    if (!current) return;
    if (s === 'note' && !note.trim()) shakeNote();
    play('stamp');
    setInk(s);
    setShake(true);
    setTimeout(() => setShake(false), 230);
  };

  const submit = () => {
    if (!current) return callNext();
    // A note sent without a stamp counts as "NOTE only" (send back).
    const s: Stamp | null = ink ?? (note.trim() ? 'note' : null);
    if (!s) return;
    if (s === 'note' && !note.trim()) return shakeNote();
    send({ type: 'decide', appId: current.id, stamp: s, note: note.trim() || undefined });
    play('paper');
    setLeaving({ w: walker(current), passed: s === 'approve' || s === 'permanent' });
    setTimeout(() => setLeaving(null), 4000);
    setCurrentId(null);
    setInk(null);
    setNote('');
    noteRef.current?.blur();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (folderId || rulesOpen) {
        if (e.key === 'Escape') {
          setFolderId(null);
          setRulesOpen(false);
        }
        return;
      }
      const el = e.target as HTMLElement;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        if (el.id === 'note' && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'a') stamp('approve');
      else if (k === 'r') stamp('deny');
      else if ((k === 'p' || k === 'k') && current?.canPersist) stamp('permanent'); // P (English) / K (Kalıcı)
      else if (k === 'n') {
        e.preventDefault();
        noteRef.current?.focus();
      } else if (e.key === 'Enter' && el.tagName !== 'BUTTON') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const processed = sessions.reduce((n, s) => n + s.history.filter((h) => h.at >= today.getTime() && h.stamp !== 'terminal').length, 0);
  const folder = folderId ? sById.get(folderId) : undefined;
  const portraitPhase = current ? 'idle' : leaving ? 'leave' : 'empty';
  const waitMs = current ? now - current.createdAt : 0;

  return (
    <I18n.Provider value={t}>
      <div className={`app${shake ? ' shake' : ''}`}>
        <header className="plaza">
          <Plaza queue={waiting.map(walker)} entering={current ? walker(current) : undefined} leaving={leaving ?? undefined} />
          <div className="hud">
            <div className="plate">
              {t.plateTitle} <b>{today.toLocaleDateString(t.locale)}</b>{' '}
              {new Date(now).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="plate">
              {t.queue} <b>{waiting.length}</b>
              {waiting.length > 0 && <> · {t.oldest} {mmss(now - waiting[0].createdAt)}</>}
            </div>
            <span className="spacer" />
            <button className={`btn next${!current && waiting.length ? ' ready' : ''}`} disabled={!!current || !waiting.length} onClick={callNext}>
              {t.next}
            </button>
            <button className="btn" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
              {t.settings}
            </button>
          </div>
          {showSettings && (
            <div className="settings">
              <label>
                {t.language}
                <select value={settings.lang} onChange={(e) => setSettings({ ...settings, lang: e.target.value as Lang })}>
                  <option value="en">English</option>
                  <option value="tr">Türkçe</option>
                </select>
              </label>
              <label>
                <input type="checkbox" checked={settings.crt} onChange={(e) => setSettings({ ...settings, crt: e.target.checked })} /> {t.crt}
              </label>
              <label>
                <input type="checkbox" checked={settings.sound} onChange={(e) => setSettings({ ...settings, sound: e.target.checked })} /> {t.sound}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.notify}
                  onChange={async (e) => {
                    const on = e.target.checked;
                    if (on && 'Notification' in window && Notification.permission !== 'granted') await Notification.requestPermission();
                    setSettings({ ...settings, notify: on });
                  }}
                />{' '}
                {t.notifications}
              </label>
              <button className="btn" onClick={() => send({ type: 'demo' })}>
                {t.demo}
              </button>
            </div>
          )}
        </header>

        <div className="row">
          <section className="window" aria-label={t.booth}>
            <div className="portrait">
              <Portrait look={current ? walker(current).look : leaving?.w.look} phase={portraitPhase} />
              {current && <span className={`timer${waitMs > 120_000 ? ' late' : ''}`}>⏱ {mmss(waitMs)}</span>}
            </div>
            <div className="dialogue" aria-live="polite">
              {current && currentSession ? (
                <>
                  <p className="you">
                    <span className="who">{t.officer}</span>
                    <br />
                    {t.officerLine}
                  </p>
                  <p>
                    <span className="who">{currentSession.name}</span>
                    <br />
                    {t.requesting(current.tool, current.summary.slice(0, 160))}
                  </p>
                </>
              ) : (
                <p className="empty-booth">
                  {waiting.length ? t.someoneWaiting : t.windowEmpty}
                  <br />
                  <br />
                  {t.shortcuts}
                </p>
              )}
            </div>
            {logs.length > 0 && (
              <div className="radio">
                <h3>{t.radio}</h3>
                {[...logs].reverse().map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
          </section>

          <Desk
            app={current}
            ink={ink}
            note={note}
            setNote={setNote}
            noteRef={noteRef}
            noteShake={noteShake}
            processed={processed}
            onStamp={stamp}
            onSubmit={submit}
            onRules={() => setRulesOpen(true)}
            onPageTurn={() => play('page')}
          />

          <Cabinet sessions={sessions} onOpen={setFolderId} />
        </div>

        {folder && <Folder s={folder} onClose={() => setFolderId(null)} onMail={(text) => send({ type: 'mail', sessionId: folder.id, text })} />}
        {rulesOpen && <RuleBook cwd={currentSession?.cwd ?? sessions[0]?.cwd ?? ''} token={TOKEN} onClose={() => setRulesOpen(false)} />}
        {settings.crt && <div className="crt" />}
        {(!TOKEN || !connected) && (
          <div className="offline">
            <div>
              <h1>{t.closedTitle}</h1>
              <p>{TOKEN ? t.closedNoServer : t.closedNoToken}</p>
            </div>
          </div>
        )}
      </div>
    </I18n.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
