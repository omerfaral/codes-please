// File cabinet (session folders), an open folder (history, messages, mail) and the Rule Book.
import { useEffect, useRef, useState } from 'react';
import type { RuleSource, Session } from '../../server/types.ts';
import { useT } from './i18n.ts';

export function Cabinet({ sessions, onOpen }: { sessions: Session[]; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <aside className="cabinet" aria-label={t.cabinetAria}>
      <h2>{t.cabinet}</h2>
      <div className="drawer-front">
        {!sessions.length && <p style={{ fontSize: 16, color: '#2a2c26' }}>{t.noSessions}</p>}
        {sessions.map((s) => (
          <button key={s.id} className="folder" style={{ ['--c' as string]: s.color }} onClick={() => onOpen(s.id)}>
            <span className="tab">{s.name}</span>
            <span className="front">
              <span className={`label ${s.status}`}>{t.status[s.status]}</span>
              {s.mailbox.some((m) => !m.deliveredAt) && <span className="mailflag">✉</span>}
            </span>
            {s.status === 'working' && s.activity && <span className="activity">› {s.activity}</span>}
          </button>
        ))}
      </div>
    </aside>
  );
}

export function Folder({ s, onClose, onMail }: { s: Session; onClose: () => void; onMail: (text: string) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  // Keep the live log scrolled to the newest line as the agent works.
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [s.recent]);
  const hhmm = (at: number) => new Date(at).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' });
  const waiting = s.mailbox.filter((m) => !m.deliveredAt);
  const send = () => {
    if (!text.trim()) return;
    onMail(text);
    setText('');
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={s.name} style={{ ['--c' as string]: s.color }} onClick={(e) => e.stopPropagation()}>
        <button className="btn close" onClick={onClose}>{t.close}</button>
        <h2>{s.name}</h2>
        <div className="meta">
          {s.cwd} — <span className={`label ${s.status}`}>{t.status[s.status]}</span>
        </div>

        <h3>{t.stampHistory}</h3>
        {s.history.length ? (
          <table>
            <tbody>
              {[...s.history].reverse().map((h, i) => (
                <tr key={i}>
                  <td>{hhmm(h.at)}</td>
                  <td><span className={`chip ${h.stamp}`}>{t.historyStamp[h.stamp]}</span></td>
                  <td>{h.tool}</td>
                  <td className="sum">
                    {h.summary}
                    {h.note && <div style={{ color: '#24375e' }}>✎ {h.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="meta">{t.noStamps}</p>
        )}

        <h3>{t.recent}</h3>
        <div className="chat" ref={chatRef}>
          {s.recent.length ? (
            s.recent.map((m, i) =>
              m.role === 'tool' ? (
                <p key={i} className="tool">› {m.text}</p>
              ) : (
                <p key={i}>
                  <span className="r">{m.role === 'user' ? t.user : t.agent}</span>
                  <br />
                  {m.text}
                </p>
              ),
            )
          ) : (
            <p className="meta">{t.noRecords}</p>
          )}
        </div>

        <h3>{t.writeToSession}</h3>
        {waiting.length > 0 && (
          <p>
            <span className="wax">{t.awaitingSeal}</span> <span className="meta">{t.awaitingHint}</span>
          </p>
        )}
        <div className="compose">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
              e.stopPropagation();
            }}
            placeholder={t.mailPlaceholder}
          />
          <button className="btn" onClick={send} disabled={!text.trim() || s.status === 'closed'}>
            {t.post}
          </button>
        </div>
        {[...s.mailbox].reverse().map((m) => (
          <div key={m.id} className="mail">
            <span>{m.text}</span>
            <small>{m.deliveredAt ? t.delivered(hhmm(m.deliveredAt), t.via[m.via ?? ''] ?? m.via ?? '') : t.awaiting}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RuleBook({ cwd, token, onClose }: { cwd: string; token: string; onClose: () => void }) {
  const t = useT();
  const [sources, setSources] = useState<RuleSource[] | null>(null);
  useEffect(() => {
    fetch(`/api/rules?cwd=${encodeURIComponent(cwd)}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setSources)
      .catch(() => setSources([]));
  }, [cwd, token]);
  let n = 0;
  const section = (title: string, list: string[]) =>
    list.length > 0 && (
      <>
        <h3>{title}</h3>
        {list.map((r) => (
          <div key={title + r} className="article">
            <b>{t.article} {++n}</b>
            {r}
          </div>
        ))}
      </>
    );
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet rules" role="dialog" aria-label={t.rulesTitle} onClick={(e) => e.stopPropagation()}>
        <button className="btn close" onClick={onClose}>{t.close}</button>
        <h2>{t.rulesTitle}</h2>
        <div className="meta">{t.rulesSubtitle}</div>
        {sources === null && <p>{t.loading}</p>}
        {sources?.length === 0 && <p className="meta">{t.noRules}</p>}
        {sources?.map((s) => (
          <section key={s.file}>
            <p className="src">{t.source}: {s.file}</p>
            {section(t.allowed, s.allow)}
            {section(t.forbidden, s.deny)}
            {section(t.askFirst, s.ask)}
            {!s.allow.length && !s.deny.length && !s.ask.length && <p className="meta">{t.noRulesInFile}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
