/**
 * PROTOTYPE — the ember field behind the login scene, and the spark burst of
 * the strike. Canvas 2D, no dependency.
 *
 * Every particle is coloured by temperature along the incandescence ramp —
 * white-hot, yellow, orange, cherry — and cools as it lives, so a spark leaves
 * the anvil white and dies red, the way hot iron actually does.
 *
 * Budget: ambient embers capped at AMBIENT, device pixel ratio capped at 2, the
 * loop stops outright while the tab is hidden. Not mounted at all under reduced
 * motion — the caller decides that.
 */
import { useEffect, useRef, type RefObject } from "react";

const AMBIENT = 60;
const BURST = 90;

/** Incandescence, hottest first: white-hot → yellow → orange → cherry. */
const RAMP: [number, number, number][] = [
  [255, 246, 224],
  [255, 180, 58],
  [226, 86, 27],
  [142, 27, 14],
];

function heatColor(t: number, alpha: number) {
  // t = 1 hottest, 0 coldest.
  const x = (1 - Math.max(0, Math.min(1, t))) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [RAMP[i], RAMP[i + 1]];
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

type Particle = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  heat: number;
  spark: boolean;
  wobble: number;
};

export type Burst = { x: number; y: number; key: number };

export function ForgeEmbers({
  burst,
  sourceRef,
}: {
  /** Viewport coordinates of the strike; a new `key` fires a burst. */
  burst: Burst | null;
  /** The fire mouth; embers are born inside it. */
  sourceRef: RefObject<SVGGraphicsElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const spawnEmber = (seeded: boolean): Particle => {
      // Most leave the fire mouth and climb the chimney; the rest drift up
      // off the floor. Both die on the way up.
      const mouth = sourceRef.current?.getBoundingClientRect();
      const fromMouth = mouth && mouth.width > 0 && Math.random() < 0.72;
      const spread = (Math.random() + Math.random() + Math.random()) / 3 - 0.5;
      let x: number;
      let y: number;
      if (fromMouth) {
        x = mouth.left + mouth.width * (0.5 + spread * 0.9);
        y = mouth.top + mouth.height * (0.35 + Math.random() * 0.5);
        if (seeded) y -= Math.random() * mouth.top * 0.8;
      } else {
        x = width * 0.4 + spread * width * 1.1;
        y = seeded ? height * (0.5 + Math.random() * 0.5) : height + 8;
      }
      return {
        x,
        y,
        px: x,
        py: y,
        vx: (Math.random() - 0.5) * 22,
        vy: -(34 + Math.random() * 80),
        age: seeded ? Math.random() * 2 : 0,
        life: 2.2 + Math.random() * 3.6,
        size: 0.6 + Math.random() * 1.1,
        heat: 0.55 + Math.random() * 0.4,
        spark: false,
        wobble: Math.random() * Math.PI * 2,
      };
    };
    for (let i = 0; i < AMBIENT; i++) particles.current.push(spawnEmber(true));

    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      const alive: Particle[] = [];
      let embers = 0;
      for (const p of particles.current) {
        p.age += dt;
        if (p.age >= p.life || p.y < -20) continue;
        p.px = p.x;
        p.py = p.y;
        if (p.spark) {
          p.vy += 980 * dt; // gravity
          p.vx *= 1 - 0.6 * dt; // drag
        } else {
          p.wobble += dt * 1.6;
          p.vx += Math.sin(p.wobble) * 6 * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        const k = p.age / p.life;
        const t = p.heat * (1 - k);
        const alpha = p.spark
          ? 1 - k * k
          : Math.sin(Math.PI * Math.min(1, k * 1.15)) * 0.9;
        if (p.spark) {
          ctx.strokeStyle = heatColor(t + 0.15, alpha);
          ctx.lineWidth = p.size;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.px - p.vx * dt * 1.5, p.py - p.vy * dt * 1.5);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else {
          // A short streak along its own path, with a faint halo: a fleck of
          // burning scale caught mid-rise, not a bokeh dot.
          embers++;
          const tail = 0.035;
          ctx.lineCap = "round";
          ctx.strokeStyle = heatColor(t, alpha * 0.18);
          ctx.lineWidth = p.size * 4;
          ctx.beginPath();
          ctx.moveTo(p.x - p.vx * tail, p.y - p.vy * tail);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.strokeStyle = heatColor(t + 0.25, alpha);
          ctx.lineWidth = p.size;
          ctx.beginPath();
          ctx.moveTo(p.x - p.vx * tail, p.y - p.vy * tail);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        alive.push(p);
      }
      for (let i = embers; i < AMBIENT; i++) {
        if (Math.random() < 0.08) alive.push(spawnEmber(false));
      }
      particles.current = alive;
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sourceRef]);

  useEffect(() => {
    if (!burst) return;
    for (let i = 0; i < BURST; i++) {
      // Upper half-plane, fanned wide, a few thrown nearly flat.
      const angle = -Math.PI * (0.06 + Math.random() * 0.88);
      const speed = 220 + Math.random() * 620;
      particles.current.push({
        x: burst.x + (Math.random() - 0.5) * 60,
        y: burst.y,
        px: burst.x,
        py: burst.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.5 + Math.random() * 1.1,
        size: 1 + Math.random() * 1.6,
        heat: 1,
        spark: true,
        wobble: 0,
      });
    }
  }, [burst]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 size-full"
    />
  );
}
