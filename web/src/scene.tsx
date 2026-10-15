// Pixel scene: the queue in the plaza (side view) and the applicant's portrait in the booth window.
// Every figure is an original, procedural drawing generated from the session id.
import { useEffect, useRef } from 'react';
import { useT } from './i18n.ts';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: number;
  hat: number;
  mustache: boolean;
  glasses: boolean;
  beard: boolean;
  coat: string;
}

function rng(seed: string) {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

const SKINS = ['#e3b98f', '#c99a6e', '#a8774f', '#7f5434', '#efcaa2', '#b98a62'];
const HAIRS = ['#2b2018', '#4a3322', '#6b4b2a', '#8a8a80', '#b08850', '#1d1d1d'];

const looks = new Map<string, Look>();

/** A session always gets the same character (with the same object identity). */
export function lookFor(sessionId: string, coat: string): Look {
  const hit = looks.get(sessionId);
  if (hit) return hit;
  const r = rng(sessionId);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const look: Look = {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle: Math.floor(r() * 4),
    hat: Math.floor(r() * 4), // 0 none, 1 flat cap, 2 fur hat, 3 fedora
    mustache: r() < 0.45,
    glasses: r() < 0.3,
    beard: r() < 0.2,
    coat,
  };
  looks.set(sessionId, look);
  return look;
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

type Ctx = CanvasRenderingContext2D;
const px = (ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

// ── Plaza ──────────────────────────────────────────
export const PLAZA_W = 400;
export const PLAZA_H = 64;
const GROUND = 52;
const BOOTH_X = 336;
const DOOR_X = BOOTH_X - 6;

export interface Walker {
  id: string;
  look: Look;
}

function drawWalker(ctx: Ctx, x: number, look: Look, t: number, moving: boolean) {
  const y = GROUND;
  const step = moving ? Math.floor(t / 140) % 2 : 0;
  px(ctx, '#00000030', x - 3, y, 7, 1);
  px(ctx, '#2a2620', x - 2 + step, y - 4, 1, 4);
  px(ctx, '#2a2620', x + 1 - step, y - 4, 1, 4);
  px(ctx, look.coat, x - 3, y - 12, 6, 8);
  px(ctx, shade(look.coat, 0.7), x + 2, y - 12, 1, 8);
  px(ctx, look.skin, x - 2, y - 16, 4, 4);
  px(ctx, look.hair, x - 2, y - 17, 4, 1);
  if (look.hat === 1 || look.hat === 3) px(ctx, '#2e2a24', x - 3, y - 18, 6, 2);
  if (look.hat === 2) px(ctx, '#5a4632', x - 3, y - 19, 6, 3);
}

function drawBackdrop(ctx: Ctx, t: number) {
  // Sky: pale, banded
  const bands = ['#6c7266', '#666c60', '#61675a', '#5d6355'];
  bands.forEach((c, i) => px(ctx, c, 0, i * 5, PLAZA_W, 5));
  // Distant border wall and barbed wire
  px(ctx, '#4b4f45', 0, 20, PLAZA_W, 16);
  for (let x = 0; x < PLAZA_W; x += 24) px(ctx, '#41443b', x, 20, 1, 16);
  for (let x = 0; x < PLAZA_W; x += 4) px(ctx, '#2f312b', x, 18 + ((x / 4) % 2), 2, 1);
  // Watchtower
  px(ctx, '#3e4038', 28, 4, 3, 32);
  px(ctx, '#3e4038', 40, 4, 3, 32);
  px(ctx, '#34362f', 24, 2, 23, 7);
  px(ctx, Math.floor(t / 900) % 3 ? '#d9c77d' : '#8a8050', 31, 4, 8, 3);
  // Ground: cobblestones
  px(ctx, '#77776a', 0, 36, PLAZA_W, PLAZA_H - 36);
  for (let y = 38; y < PLAZA_H; y += 3)
    for (let x = (y % 2) * 3; x < PLAZA_W; x += 7) px(ctx, '#6b6b5e', x, y, 3, 1);
  // Queue barrier
  for (let x = 60; x < DOOR_X - 4; x += 16) px(ctx, '#2f2c26', x, GROUND - 7, 1, 7);
  px(ctx, '#8a3a2a', 60, GROUND - 7, DOOR_X - 64, 1);
  // Booth
  px(ctx, '#2c2a25', BOOTH_X - 4, 12, 52, 4);
  px(ctx, '#857a5e', BOOTH_X, 16, 44, GROUND - 16);
  px(ctx, '#6f6650', BOOTH_X + 38, 16, 6, GROUND - 16);
  px(ctx, '#3b3428', DOOR_X + 2, 30, 6, GROUND - 30);
  px(ctx, '#d8c27a', BOOTH_X + 12, 22, 18, 10);
  px(ctx, '#bfa966', BOOTH_X + 12, 30, 18, 2);
  px(ctx, '#2c2a25', BOOTH_X + 20, 22, 1, 10);
  // Booth lamp
  px(ctx, '#2c2a25', BOOTH_X + 50, 6, 2, GROUND - 6);
  px(ctx, '#e8d48a', BOOTH_X + 47, 6, 8, 2);
  px(ctx, '#e8d48a22', BOOTH_X + 40, 8, 22, 16);
  // Border gate on the far side
  px(ctx, '#3a3c35', PLAZA_W - 10, 22, 10, GROUND - 22);
}

export function Plaza({ queue, entering, leaving }: { queue: Walker[]; entering?: Walker; leaving?: { w: Walker; passed: boolean } }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ queue, entering, leaving });
  props.current = { queue, entering, leaving };
  const people = useRef(new Map<string, { x: number; look: Look; target: number }>());

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(50, t - last);
      last = t;
      const { queue, entering, leaving } = props.current;
      const map = people.current;
      const alive = new Set<string>();
      queue.forEach((w, i) => {
        alive.add(w.id);
        const p = map.get(w.id) ?? { x: -10 - i * 6, look: w.look, target: 0 };
        p.target = Math.max(DOOR_X - 10 - i * 11, 8);
        map.set(w.id, p);
      });
      if (entering) {
        alive.add(entering.id);
        const p = map.get(entering.id) ?? { x: DOOR_X - 20, look: entering.look, target: 0 };
        p.target = DOOR_X + 4;
        map.set(entering.id, p);
      }
      if (leaving) {
        const key = leaving.w.id + ':out';
        alive.add(key);
        if (!map.has(key))
          map.set(key, { x: leaving.passed ? BOOTH_X + 44 : DOOR_X, look: leaving.w.look, target: leaving.passed ? PLAZA_W + 10 : -20 });
      }
      for (const k of [...map.keys()]) if (!alive.has(k)) map.delete(k);

      drawBackdrop(ctx, t);
      const sorted = [...map.entries()].sort((a, b) => a[1].x - b[1].x);
      for (const [k, p] of sorted) {
        const d = p.target - p.x;
        const moving = Math.abs(d) > 0.5;
        if (moving) p.x += Math.sign(d) * Math.min(Math.abs(d), dt * 0.03);
        // The figure entering the booth disappears at the door.
        if (k === entering?.id && p.x >= DOOR_X + 3) continue;
        drawWalker(ctx, p.x, p.look, t, moving);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} width={PLAZA_W} height={PLAZA_H} aria-label={t.queueAria(queue.length)} role="img" />;
}

// ── Portrait (booth window) ─────────────────────────────
const PW = 80;
const PH = 64;

function drawBust(ctx: Ctx, l: Look, ox: number, oy: number, blink: boolean) {
  const cx = 40 + ox;
  const top = 12 + oy;
  // Shoulders and coat
  px(ctx, shade(l.coat, 0.75), cx - 22, top + 36, 44, 30);
  px(ctx, l.coat, cx - 20, top + 34, 40, 30);
  px(ctx, shade(l.coat, 0.6), cx - 1, top + 36, 2, 30);
  px(ctx, shade(l.coat, 0.85), cx - 8, top + 34, 6, 8);
  px(ctx, shade(l.coat, 0.85), cx + 2, top + 34, 6, 8);
  px(ctx, '#d9d2bd', cx - 3, top + 34, 6, 4); // collar
  // Neck
  px(ctx, shade(l.skin, 0.85), cx - 4, top + 28, 8, 7);
  // Head (corners trimmed)
  px(ctx, l.skin, cx - 9, top + 2, 18, 26);
  px(ctx, l.skin, cx - 10, top + 5, 20, 20);
  px(ctx, shade(l.skin, 0.88), cx + 6, top + 5, 4, 20);
  px(ctx, shade(l.skin, 0.9), cx - 11, top + 13, 2, 6); // ear
  px(ctx, shade(l.skin, 0.9), cx + 9, top + 13, 2, 6);
  // Hair
  if (l.hairStyle !== 3) {
    px(ctx, l.hair, cx - 10, top, 20, 5);
    if (l.hairStyle === 1) px(ctx, l.hair, cx - 10, top + 5, 3, 8);
    if (l.hairStyle === 2) px(ctx, l.hair, cx - 10, top + 5, 20, 2);
  }
  // Hat
  if (l.hat === 1) {
    px(ctx, '#2e2a24', cx - 11, top - 3, 22, 6);
    px(ctx, '#24211c', cx - 13, top + 2, 18, 2);
  } else if (l.hat === 2) {
    px(ctx, '#5a4632', cx - 12, top - 6, 24, 9);
    px(ctx, '#4a3a2a', cx - 12, top + 2, 4, 9);
    px(ctx, '#4a3a2a', cx + 8, top + 2, 4, 9);
    px(ctx, '#6c5640', cx - 10, top - 6, 20, 2);
  } else if (l.hat === 3) {
    px(ctx, '#3a3830', cx - 9, top - 7, 18, 8);
    px(ctx, '#2a2822', cx - 14, top + 1, 28, 2);
    px(ctx, '#5a3a2a', cx - 9, top - 1, 18, 1);
  }
  // Brows, eyes
  px(ctx, shade(l.hair, 0.9), cx - 7, top + 10, 5, 1);
  px(ctx, shade(l.hair, 0.9), cx + 2, top + 10, 5, 1);
  if (blink) {
    px(ctx, '#3a2a20', cx - 6, top + 13, 4, 1);
    px(ctx, '#3a2a20', cx + 2, top + 13, 4, 1);
  } else {
    px(ctx, '#f1ead6', cx - 6, top + 12, 4, 2);
    px(ctx, '#f1ead6', cx + 2, top + 12, 4, 2);
    px(ctx, '#2a1e16', cx - 5, top + 12, 2, 2);
    px(ctx, '#2a1e16', cx + 3, top + 12, 2, 2);
  }
  if (l.glasses) {
    px(ctx, '#2a2620', cx - 7, top + 11, 6, 1);
    px(ctx, '#2a2620', cx + 1, top + 11, 6, 1);
    px(ctx, '#2a2620', cx - 7, top + 14, 6, 1);
    px(ctx, '#2a2620', cx + 1, top + 14, 6, 1);
    px(ctx, '#2a2620', cx - 1, top + 12, 2, 1);
  }
  // Nose, mouth, beard/moustache
  px(ctx, shade(l.skin, 0.78), cx, top + 15, 2, 5);
  px(ctx, shade(l.skin, 0.7), cx - 1, top + 20, 3, 1);
  if (l.beard) {
    px(ctx, l.hair, cx - 9, top + 22, 18, 6);
    px(ctx, l.hair, cx - 6, top + 28, 12, 3);
  }
  if (l.mustache) px(ctx, l.hair, cx - 4, top + 21, 9, 2);
  px(ctx, '#7a3e32', cx - 3, top + 24, 6, 1);
}

function drawWindow(ctx: Ctx, t: number) {
  px(ctx, '#6a7062', 0, 0, PW, PH);
  px(ctx, '#5d6355', 0, 30, PW, PH - 30);
  for (let x = 0; x < PW; x += 9) px(ctx, '#555b4e', x, 30, 1, PH - 30);
  for (let i = 0; i < 14; i++) px(ctx, '#ffffff10', (i * 37) % PW, (i * 23 + Math.floor(t / 400)) % PH, 1, 3);
}

function drawFrame(ctx: Ctx) {
  px(ctx, '#ffffff0d', 6, 0, 10, PH);
  px(ctx, '#ffffff08', 18, 0, 3, PH);
  px(ctx, '#2a221d', 0, 0, PW, 2);
  px(ctx, '#2a221d', 0, 0, 2, PH);
  px(ctx, '#2a221d', PW - 2, 0, 2, PH);
  // Speaking grille and counter
  px(ctx, '#40342b', 0, PH - 6, PW, 6);
  for (let x = 30; x < 50; x += 3) px(ctx, '#1d1814', x, PH - 5, 2, 1);
}

export function Portrait({ look, phase }: { look?: Look; phase: 'empty' | 'enter' | 'idle' | 'leave' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ look, phase, since: performance.now() });
  if (state.current.look !== look || state.current.phase !== phase) state.current = { look, phase, since: performance.now() };

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    let raf = 0;
    const frame = (t: number) => {
      const { look, phase, since } = state.current;
      const e = Math.min(1, (t - since) / 500);
      drawWindow(ctx, t);
      if (look && phase !== 'empty') {
        let ox = 0;
        let oy = Math.floor(t / 700) % 2;
        if (phase === 'enter') oy += Math.round((1 - e) * 50);
        if (phase === 'leave') ox += Math.round(e * 70);
        drawBust(ctx, look, ox, oy, t % 3200 < 140);
      }
      drawFrame(ctx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} width={PW} height={PH} aria-hidden="true" />;
}
