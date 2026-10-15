// Wooden desk: draggable documents, stamp drawer, note slip, rule book, processed tray.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Application, Doc, Stamp } from '../../server/types.ts';
import { useT } from './i18n.ts';

const STAMP_IDS: Stamp[] = ['approve', 'deny', 'note', 'permanent'];
const PRESS_MS = 340; // full lift → slam → lift cycle
const IMPACT_MS = 140; // moment the rubber meets the paper

/** An ink mark on the request form, in the form's own (unscaled) pixel coordinates. */
export interface Ink {
  stamp: Stamp;
  x: number;
  y: number;
  rot: number;
}
const FORM_CODES: Record<Doc['kind'], string> = { request: 'Form T-1', diff: 'Form D-4', statement: 'Form B-2', research: 'Form R-7' };
const PAGE = 26;

function DocShell({
  kind,
  title,
  seal,
  pos,
  z,
  onGrab,
  children,
}: {
  kind: string;
  title: string;
  seal?: string;
  pos: { x: number; y: number };
  z: number;
  onGrab: (dx: number, dy: number, el?: HTMLElement) => void;
  children: ReactNode;
}) {
  const t = useT();
  const [zoom, setZoom] = useState(false);
  const [drag, setDrag] = useState(false);
  const start = useRef<{ px: number; py: number; x: number; y: number }>(undefined);
  return (
    <article
      className={`doc ${kind}${zoom ? ' zoomed' : ''}${drag ? ' dragging' : ''}`}
      style={{ left: pos.x, top: pos.y, zIndex: zoom ? 999 : z }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button,a,textarea,.scroll,.difflines')) return onGrab(0, 0);
        start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDrag(true);
        onGrab(0, 0);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        onGrab(s.x + e.clientX - s.px - pos.x, s.y + e.clientY - s.py - pos.y, e.currentTarget as HTMLElement);
      }}
      onPointerUp={() => {
        start.current = undefined;
        setDrag(false);
      }}
      onDoubleClick={() => setZoom((z) => !z)}
    >
      <header>
        <span>{title}</span>
        {seal && <span className="seal">{seal}</span>}
        <button onClick={() => setZoom((z) => !z)} aria-label={zoom ? t.zoomOut : t.zoomIn}>
          {zoom ? '–' : '+'}
        </button>
      </header>
      <div className="body">{children}</div>
    </article>
  );
}

function DiffPages({ doc, onPageTurn }: { doc: Extract<Doc, { kind: 'diff' }>; onPageTurn: () => void }) {
  const t = useT();
  const [page, setPageRaw] = useState(0);
  const setPage = (p: number) => {
    setPageRaw(p);
    onPageTurn();
  };
  const pages = Math.max(1, Math.ceil(doc.lines.length / PAGE));
  const lines = doc.lines.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <>
      <dl>
        <dt>{t.file}</dt>
        <dd>{doc.file}</dd>
      </dl>
      <p className="counts">
        {doc.isNew ? `${t.newFile} · ` : ''}
        <span className="a">+{doc.added}</span> <span className="d">−{doc.removed}</span>
      </p>
      <div className="difflines">
        {lines.map((l, i) =>
          l.o === undefined && l.n === undefined && l.t === ' ' ? (
            <div key={i} className="gap">⋯</div>
          ) : (
            <div key={i} className={l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}>
              <span className="num">{l.o ?? ''}</span>
              <span className="num">{l.n ?? ''}</span>
              <span>{l.t + ' ' + l.text}</span>
            </div>
          ),
        )}
      </div>
      {pages > 1 && (
        <div className="pager">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>{t.prev}</button>
          <span>{t.page(page + 1, pages)}</span>
          <button disabled={page === pages - 1} onClick={() => setPage(page + 1)}>{t.nextPage}</button>
        </div>
      )}
    </>
  );
}

function DocBody({
  doc,
  ink,
  onHandBack,
  canHandBack,
  onPageTurn,
}: {
  doc: Doc;
  ink: Ink | null;
  onHandBack: () => void;
  canHandBack: boolean;
  onPageTurn: () => void;
}) {
  const t = useT();
  switch (doc.kind) {
    case 'request':
      return (
        <>
          <dl>
            <dt>{t.session}</dt>
            <dd>{doc.session}</dd>
            <dt>{t.project}</dt>
            <dd>{doc.cwd}</dd>
            <dt>{t.tool}</dt>
            <dd>{doc.tool}</dd>
            <dt>{t.mode}</dt>
            <dd>{doc.mode}</dd>
            <dt>{t.time}</dt>
            <dd>{new Date(doc.at).toLocaleString(t.locale, { dateStyle: 'short', timeStyle: 'medium' })}</dd>
          </dl>
          <p style={{ margin: '8px 0 2px', fontFamily: 'var(--px)', fontSize: 11 }}>{t.requested}</p>
          <div className="cmd scroll">{doc.target}</div>
          <div className="stampbox">{t.stampHere}</div>
          {ink && (
            <span key={`${ink.x},${ink.y}`} className={`ink ${ink.stamp}`} style={{ left: ink.x, top: ink.y, rotate: `${ink.rot}deg` }}>
              {t.stamps[ink.stamp].ink}
            </span>
          )}
          <button className="handback" disabled={!canHandBack} onClick={onHandBack}>
            {t.handBack}
          </button>
        </>
      );
    case 'diff':
      return <DiffPages doc={doc} onPageTurn={onPageTurn} />;
    case 'statement':
      return <>{doc.text}</>;
    case 'research':
      return (
        <div className="scroll">
          {doc.items.map((it, i) => (
            <div key={i} className="item">
              <div className="tool">{it.tool}</div>
              <div>{it.target}</div>
              {it.excerpt && <div className="ex">{it.excerpt}</div>}
              {it.links.map((l) => (
                <a key={l} href={l} target="_blank" rel="noreferrer noopener">{l}</a>
              ))}
            </div>
          ))}
        </div>
      );
  }
}

export function Desk({
  app,
  ink,
  note,
  setNote,
  noteRef,
  noteShake,
  processed,
  onStamp,
  onSubmit,
  onRules,
  onPageTurn,
  pressRef,
}: {
  app: Application | null;
  ink: Ink | null;
  note: string;
  setNote: (s: string) => void;
  noteRef: RefObject<HTMLTextAreaElement | null>;
  noteShake: boolean;
  processed: number;
  /** Called at the moment of impact; `at` is null when the stamp hit bare desk. */
  onStamp: (s: Stamp, at: { x: number; y: number } | null) => void;
  onSubmit: () => void;
  onRules: () => void;
  onPageTurn: () => void;
  /** Lets keyboard shortcuts press a stamp; `auto` aims it at the form's stamp box. */
  pressRef: RefObject<((s: Stamp, auto?: boolean) => void) | null>;
}) {
  const t = useT();
  const deskRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [pressing, setPressing] = useState<Stamp | null>(null);

  // Like a real stamp: whatever part of the request form lies under the rubber face gets inked.
  const press = (id: Stamp, auto = false) => {
    if (!app || pressing || (id === 'permanent' && !app.canPersist)) return;
    const desk = deskRef.current!;
    const form = desk.querySelector<HTMLElement>('.doc.request');
    const target = auto ? form?.querySelector('.stampbox') : desk.querySelector(`.stamp.${id} .face`);
    let at: { x: number; y: number } | null = null;
    if (form && target) {
      const f = form.getBoundingClientRect();
      const s = target.getBoundingClientRect();
      const cx = s.left + s.width / 2;
      const cy = s.top + s.height / 2;
      const scale = f.width / form.offsetWidth; // the form may be zoomed
      if (cx >= f.left && cx <= f.right && cy >= f.top && cy <= f.bottom) at = { x: (cx - f.left) / scale, y: (cy - f.top) / scale };
    }
    setDrawer(true);
    setPressing(id);
    setTimeout(() => onStamp(id, at), IMPACT_MS);
    setTimeout(() => setPressing(null), PRESS_MS);
  };
  pressRef.current = press;

  // New application: spread the documents on the desk as a pile.
  useLayoutEffect(() => {
    if (!app) return;
    const w = deskRef.current?.clientWidth ?? 900;
    // Pile order: request form on the left; statement and report underneath, change certificate on top.
    const rank: Record<Doc['kind'], number> = { request: 0, statement: 1, research: 2, diff: 3 };
    const order = app.docs.map((_, i) => i).sort((a, b) => rank[app.docs[a].kind] - rank[app.docs[b].kind]);
    setPos(
      app.docs.map((d, i) => {
        if (d.kind === 'request') return { x: 24, y: 18 };
        const k = order.indexOf(i) - 1;
        const width = d.kind === 'diff' ? 470 : 330;
        return { x: Math.max(24, Math.min(w - width - 40, 380 + k * 40)), y: 18 + k * 44 };
      }),
    );
    setOrder(order);
    setDrawer(true);
  }, [app?.id]);

  useEffect(() => {
    if (!app) setDrawer(false);
  }, [app]);

  return (
    <section className="desk" ref={deskRef} aria-label={t.desk}>
      {!app && <div className="desk-hint">{t.deskEmpty}</div>}
      {app?.docs.map((doc, i) =>
        pos[i] ? (
          <DocShell
            key={app.id + i}
            kind={doc.kind}
            title={t.docTitles[doc.kind]}
            seal={FORM_CODES[doc.kind]}
            pos={pos[i]}
            z={order.indexOf(i) + 1}
            onGrab={(dx, dy, el) => {
              setOrder((o) => [...o.filter((j) => j !== i), i]);
              if (!dx && !dy) return;
              // Papers may slide off any edge (e.g. up under the stamps), but 60px always stays on the desk to grab.
              const w = deskRef.current?.clientWidth ?? 900;
              const h = deskRef.current?.clientHeight ?? 600;
              const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
              const ew = el?.offsetWidth ?? 300;
              const eh = el?.offsetHeight ?? 300;
              setPos((p) => p.map((q, j) => (j === i ? { x: clamp(q.x + dx, 60 - ew, w - 60), y: clamp(q.y + dy, 60 - eh, h - 60) } : q)));
            }}
          >
            <DocBody doc={doc} ink={ink} onHandBack={onSubmit} canHandBack={!!ink || !!note.trim()} onPageTurn={onPageTurn} />
          </DocShell>
        ) : null,
      )}

      <div className={`slip${noteShake ? ' shake' : ''}`}>
        <label htmlFor="note">{t.noteSlip}</label>
        <textarea
          id="note"
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.notePlaceholder}
          maxLength={4000}
        />
        <small>{t.noteHint}</small>
      </div>

      <button className="book" onClick={onRules}>
        {t.ruleBook[0]}
        <br />
        {t.ruleBook[1]}
      </button>

      <div className="tray" aria-live="polite">
        <span>{t.processed}</span>
        <b>{processed}</b>
      </div>

      <div className={`drawer${drawer ? ' open' : ''}`}>
        <button className="pull" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer}>
          {t.stampsDrawer}
        </button>
        <div className="tray-in">
          {STAMP_IDS.map((id) => (
            <button
              key={id}
              className={`stamp ${id}${pressing === id ? ' pressing' : ''}`}
              disabled={!app || (id === 'permanent' && !app.canPersist)}
              onClick={() => press(id)}
            >
              <span className="grip" />
              <span className="face">
                {t.stamps[id].label}
                <kbd>{t.stamps[id].key}</kbd>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
