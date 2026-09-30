import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FORGE_BOX,
  type EmberFieldProps,
  type StrikingWordProps,
} from "./LoginLockup";
import "./login-scene.css";

/**
 * The login scene's motion (#343), loaded only by `LoginLockup` and only while
 * motion is allowed: this module and its stylesheet are a chunk no other page
 * requests. Everything here animates opacity and transform, or draws to one
 * canvas; nothing animates a colour.
 */

/** How long FORGE waits dark before the hammer lands. */
const STRIKE_DELAY_MS = 300;

/**
 * FORGE, struck once on mount: a flash of white heat and a ring of air behind
 * the letters, then the word cools white-hot → orange → cherry → iron. The
 * cooling is four stacked copies of the word cross-faded (`login-scene.css`),
 * so the glyphs composite instead of repainting every frame. The base copy is
 * the still word exactly, so handing back to it once the base has faded fully
 * in shows nothing change.
 */
export function StrikingWord({ onStrike, onCooled }: StrikingWordProps) {
  const word = useRef<HTMLSpanElement>(null);
  const [struck, setStruck] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStruck(true);
      if (word.current) onStrike(word.current.getBoundingClientRect());
    }, STRIKE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [onStrike]);

  return (
    <span
      ref={word}
      aria-hidden="true"
      className={cn(FORGE_BOX, "relative grid", struck && "is-struck")}
    >
      <span className="strike-flash" />
      <span className="strike-ring" />
      {/* The base is the longest of the four, so its end is the cooled state. */}
      <span
        className="strike-copy strike-base lit-iron"
        onAnimationEnd={onCooled}
      >
        Forge
      </span>
      <span className="strike-copy strike-cherry">Forge</span>
      <span className="strike-copy strike-orange">Forge</span>
      <span className="strike-copy strike-white">Forge</span>
    </span>
  );
}

/** Ambient embers on screen at once, at most. */
const EMBERS = 60;
/** Sparks thrown off the word by the strike. Not embers: they are gone in ~1.6 s. */
const SPARKS = 120;
/** Beyond 2 the canvas costs fill rate nobody can see. */
const MAX_PIXEL_RATIO = 2;

/** The incandescence ramp, hottest first — the only heat colours there are. */
const RAMP: readonly (readonly [number, number, number])[] = [
  [0xff, 0xf6, 0xe0], // #fff6e0 white-hot
  [0xff, 0xb4, 0x3a], // #ffb43a yellow
  [0xe2, 0x56, 0x1b], // #e2561b orange
  [0x8e, 0x1b, 0x0e], // #8e1b0e cherry
];

/** A point on the ramp: `heat` 1 is white-hot, 0 is cherry. */
function heatColor(heat: number, alpha: number) {
  const x = (1 - Math.max(0, Math.min(1, heat))) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const [r, g, b] = RAMP[i].map((v, k) =>
    Math.round(v + (RAMP[i + 1][k] - v) * f),
  );
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  heat: number;
  spark: boolean;
  wobble: number;
};

/**
 * Embers rising from the glow below for as long as the page is open, and the
 * strike's sparks when `struckAt` (the word's viewport rect) arrives. They take
 * no notice of the cursor.
 *
 * The budget is the point of this component: never more than `EMBERS` embers
 * (published as `data-ember-count` for `login-scene.spec.ts`), the pixel ratio
 * capped at `MAX_PIXEL_RATIO`, and the loop stopped outright while the tab is
 * hidden. The caller does not mount it under reduced motion.
 */
export function EmberField({ struckAt }: EmberFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Off the forge below the scene, bunched under the word, most dying on the
    // way up. `seeded` scatters the first batch so the field opens full.
    const ember = (seeded: boolean): Particle => {
      const spread = (Math.random() + Math.random() + Math.random()) / 3 - 0.5;
      return {
        x: width * (0.5 + spread * 1.1),
        y: seeded ? height * (0.4 + Math.random() * 0.6) : height + 8,
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
    for (let i = 0; i < EMBERS; i++) particles.current.push(ember(true));

    let published = -1;
    let last = 0;
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      const alive: Particle[] = [];
      let embers = 0;
      for (const p of particles.current) {
        p.age += dt;
        if (p.age >= p.life || p.y < -20) continue;
        if (p.spark) {
          p.vy += 980 * dt; // gravity
          p.vx *= 1 - 0.6 * dt; // drag
        } else {
          p.wobble += dt * 1.6;
          p.vx += Math.sin(p.wobble) * 6 * dt;
          embers++;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        draw(ctx, p);
        alive.push(p);
      }
      // Refill toward the cap, a few a frame, never past it.
      for (let i = embers; i < EMBERS; i++) {
        if (Math.random() < 0.08) alive.push(ember(false));
      }
      particles.current = alive;

      if (embers !== published) {
        published = embers;
        canvas.dataset.emberCount = String(embers);
      }
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
    if (!document.hidden) start();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      particles.current = [];
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!struckAt || !canvas) return;
    const origin = canvas.getBoundingClientRect();
    const cx = struckAt.left + struckAt.width / 2 - origin.left;
    const cy = struckAt.top + struckAt.height * 0.55 - origin.top;
    for (let i = 0; i < SPARKS; i++) {
      // Off the whole struck face, mostly up and outward, a few flung down:
      // the word was hit, not a point on it.
      const angle =
        Math.random() < 0.8
          ? -Math.PI * (0.04 + Math.random() * 0.92)
          : Math.PI * (0.15 + Math.random() * 0.7);
      const speed = 200 + Math.random() * 600;
      particles.current.push({
        x: cx + (Math.random() - 0.5) * struckAt.width * 0.9,
        y: cy + (Math.random() - 0.5) * 30,
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
  }, [struckAt]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 size-full"
    />
  );
}

/**
 * One particle, cooling along the ramp as it ages. A spark is a short hot
 * streak along its velocity; an ember is a fleck of burning scale caught
 * mid-rise, a streak with a faint halo rather than a bokeh dot.
 */
function draw(ctx: CanvasRenderingContext2D, p: Particle) {
  const k = p.age / p.life;
  const heat = p.heat * (1 - k);
  const tail = p.spark ? 0.025 : 0.035;
  const streak = () => {
    ctx.beginPath();
    ctx.moveTo(p.x - p.vx * tail, p.y - p.vy * tail);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  if (p.spark) {
    ctx.strokeStyle = heatColor(heat + 0.15, 1 - k * k);
    ctx.lineWidth = p.size;
    streak();
    return;
  }
  const alpha = Math.sin(Math.PI * Math.min(1, k * 1.15)) * 0.9;
  ctx.strokeStyle = heatColor(heat, alpha * 0.18);
  ctx.lineWidth = p.size * 4;
  streak();
  ctx.strokeStyle = heatColor(heat + 0.25, alpha);
  ctx.lineWidth = p.size;
  streak();
}
