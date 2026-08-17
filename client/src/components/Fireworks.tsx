import { useEffect, useRef } from 'react';

/**
 * The `celebrate` layer behind an announcement card (WP-63) — a hand-written canvas loop, and
 * deliberately **no new dependency** for one animation that runs for a few seconds a year.
 *
 * Every constant below is a tuned value from the agreed preview, and two of them encode
 * mistakes that were already made once:
 *
 * - **Everything is in pixels per second, and gravity is near real `g` in pixel units.** The
 *   first attempt used a small number that „felt right" per frame; a rocket has to clear ~500 px
 *   in about a second to read as a rocket, which puts `G_ROCKET` at 900 and not at 9.
 * - **The trail is `destination-out`, not a translucent night-blue wash.** The backdrop has to
 *   stay see-through so the user can make out the app behind it and knows they are still inside
 *   the software. Painting half-transparent dark over the previous frame accumulates to fully
 *   opaque within a handful of frames and hides it. Subtracting alpha instead fades old pixels
 *   toward *transparent*; all the darkness comes from the scrim underneath, and the canvas is
 *   never filled with a background colour at all (`clearRect` on resize, never `fillRect`).
 *
 * Rendered only when the announcement asks for it *and* the user has not asked for reduced
 * motion — the overlay decides that, so this component always animates when it is mounted.
 */

/** Warm gold/coral. The preview also carried festival/pastel/gold-only; warm is what was agreed. */
const PALETTE = ['#ffd166', '#ff9f1c', '#ff6b6b', '#ffb347', '#ffe3a3'];

const G_ROCKET = 900; // px/s² — rocket; launch speed is −√(2·g·s) so it dies exactly at its target
const G_SPARK = 200; // px/s² — sparks are light: they hang, then rain
const DRAG_PER_SEC = 0.55; // fraction of velocity kept after one second, via Math.pow(d, dt)
const ROCKETS_PER_SEC = 1.6;
const SPARKS_PER_ROCKET = 70;
const BURST_SIZE = 1; // scales explosion power and the flash radius
const MAX_ROCKETS = 14;
const MAX_DT = 0.05; // a tab-switch must not teleport every particle across the screen
const MAX_DPR = 2;

interface Rocket {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  color: string;
  targetY: number;
}

interface Spark {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  max: number;
  twinkle: boolean;
}

interface Flash {
  x: number;
  y: number;
  life: number;
  max: number;
  r: number;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = (arr: readonly string[]): string => arr[(Math.random() * arr.length) | 0]!;

export function Fireworks() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    // Never throw out of here: a canvas context can be refused (a driver reset, too many
    // contexts), and a celebration failing has to cost the fireworks, not the message.
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let rockets: Rocket[] = [];
    let sparks: Spark[] = [];
    let flashes: Flash[] = [];
    let raf = 0;
    let last = 0;
    let spawnAcc = 0;
    let elapsed = 0;
    let running = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
    };

    const launch = () => {
      const x = rand(width * 0.14, width * 0.86);
      const targetY = rand(height * 0.1, height * 0.44);
      // v² = 2·g·s — the speed that just runs out of momentum at targetY.
      const vy = -Math.sqrt(2 * G_ROCKET * (height - targetY));
      rockets.push({ x, y: height + 8, px: x, py: height + 8, vx: rand(-40, 40), vy, color: pick(PALETTE), targetY });
    };

    const explode = (r: Rocket) => {
      const n = Math.round(SPARKS_PER_ROCKET * rand(0.82, 1.18));
      const power = 260 * BURST_SIZE;
      flashes.push({ x: r.x, y: r.y, life: 0.16, max: 0.16, r: 40 * BURST_SIZE });
      // Most bursts are one hue; now and then a two-tone one, so they do not all read alike.
      const twoTone = Math.random() < 0.28;
      const alt = pick(PALETTE);
      // A shell bias reads better than pure scatter — but a *perfect* ring looks like a
      // dandelion, so keep it a minority and jitter the angles hard.
      const ring = Math.random() < 0.35;
      for (let i = 0; i < n; i++) {
        const a = ring ? (i / n) * Math.PI * 2 + rand(-0.22, 0.22) : rand(0, Math.PI * 2);
        const speed = ring ? power * rand(0.72, 1.05) : power * Math.sqrt(rand(0.06, 1));
        const life = rand(1.3, 2.4);
        sparks.push({
          x: r.x,
          y: r.y,
          px: r.x,
          py: r.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed * 0.92,
          color: twoTone && i % 2 ? alt : r.color,
          life,
          max: life,
          twinkle: Math.random() < 0.22,
        });
      }
    };

    const frame = (ts: number) => {
      if (!running) return;
      if (!last) last = ts;
      const dt = Math.min((ts - last) / 1000, MAX_DT);
      last = ts;
      elapsed += dt;

      // See the header: subtract alpha, never paint over. This is what keeps the app visible.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.17)';
      ctx.fillRect(0, 0, width, height);

      // An opening volley, then a calmer rhythm — a constant rate reads as a screensaver.
      const intensity = 0.38 + 0.62 * Math.exp(-elapsed / 5.5);
      spawnAcc += dt * ROCKETS_PER_SEC * (0.7 + intensity);
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        if (rockets.length < MAX_ROCKETS) launch();
      }

      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const drag = Math.pow(DRAG_PER_SEC, dt);

      // The white flash does most of the work of making a burst read as an explosion.
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]!;
        f.life -= dt;
        if (f.life <= 0) {
          flashes.splice(i, 1);
          continue;
        }
        const t = f.life / f.max;
        const radius = f.r * (1.7 - 0.7 * t);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius);
        g.addColorStop(0, `rgba(255,252,240,${0.3 * t})`);
        g.addColorStop(0.28, `rgba(255,236,190,${0.1 * t})`);
        g.addColorStop(1, 'rgba(255,220,160,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]!;
        r.px = r.x;
        r.py = r.y;
        r.vy += G_ROCKET * dt;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(r.px, r.py);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
        if (r.vy >= -18 || r.y <= r.targetY) {
          explode(r);
          rockets.splice(i, 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.px = s.x;
        s.py = s.y;
        s.vx *= drag;
        s.vy *= drag;
        s.vy += G_SPARK * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const t = s.life / s.max;
        let alpha = t < 0.3 ? t / 0.3 : 1;
        if (s.twinkle && t < 0.65) alpha *= 0.4 + 0.6 * Math.random();
        ctx.strokeStyle = t > 0.88 ? '#fff6e0' : s.color; // white-hot for the first instant
        ctx.globalAlpha = alpha * 0.95;
        ctx.lineWidth = 1.6 + 1.2 * t;
        ctx.beginPath();
        ctx.moveTo(s.px, s.py);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    };

    const onResize = () => {
      if (running) resize();
    };

    resize();
    // Three rockets straight away, staggered — the card appears with the sky already busy.
    const opening = [0, 1, 2].map((i) => window.setTimeout(() => running && launch(), i * 190));
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', onResize);

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      for (const t of opening) window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
      rockets = [];
      sparks = [];
      flashes = [];
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 block h-full w-full" />;
}
