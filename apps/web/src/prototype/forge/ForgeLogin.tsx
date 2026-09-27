/**
 * PROTOTYPE — the forge login scene. Wraps the real sign-in form (passed as
 * `children`) so every behaviour of LoginPage is unchanged; only the frame is
 * new.
 *
 * Two halves of the name on screen: the forge — the hearth and its fire —
 * behind, and the anvil with the bar just drawn from it in front.
 *
 * The sequence: the page opens nearly dark, the hammer lands on the hot bar
 * (flash, shockwave, a short shake, a burst of sparks), and FORGE flashes
 * white-hot and cools through yellow, orange and cherry to lit iron. Then the
 * scene settles: the forge breathes, embers drift, the form never moves.
 *
 * Reduced motion skips straight to the cooled frame: no strike, no embers, no
 * shake — the glow and the lit wordmark stay, because reduced motion means no
 * movement, not no identity.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { ForgeEmbers, type Burst } from "./ForgeEmbers";
import { ForgeHearth } from "./ForgeHearth";
import { ForgeMark } from "./ForgeMarks";
import "./forge-login.css";

const STRIKE_AT_MS = 650;

type Phase = "dark" | "struck" | "cold";

export function ForgeLogin({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("dark");
  const [burst, setBurst] = useState<Burst | null>(null);
  const barRef = useRef<SVGRectElement>(null);
  const mouthRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (reduced) {
      setPhase("cold");
      return;
    }
    const timer = window.setTimeout(() => {
      setPhase("struck");
      const bar = barRef.current?.getBoundingClientRect();
      if (bar)
        setBurst({ x: bar.left + bar.width / 2, y: bar.top, key: Date.now() });
    }, STRIKE_AT_MS);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  return (
    <div className={`fl-root is-${phase}`}>
      <div className="fl-glow" aria-hidden="true" />
      <div className="fl-glow-flare" aria-hidden="true" />
      {!reduced && <ForgeEmbers burst={burst} sourceRef={mouthRef} />}

      <section className="fl-scene">
        <div className="fl-scene-inner">
          <h1 className="fl-lockup">
            <span className="sr-only">The Great Forge Desk</span>
            <span className="fl-line" aria-hidden="true">
              <ForgeMark
                variant="H1"
                className="fl-mark"
                colors={{
                  bronze: "#b08450",
                  iron: "#2a2624",
                  soot: "#0f0d0c",
                  heat: "#ffb43a",
                }}
              />
              <span>The Great</span>
              <i className="fl-rule" />
            </span>
            <span className="fl-word" aria-hidden="true">
              <span className="fl-w fl-w-base">Forge</span>
              <span className="fl-w fl-w-cherry">Forge</span>
              <span className="fl-w fl-w-orange">Forge</span>
              <span className="fl-w fl-w-white">Forge</span>
            </span>
            <span className="fl-line fl-line-end" aria-hidden="true">
              <i className="fl-rule fl-rule-in" />
              <span>Desk</span>
            </span>
          </h1>

          <ForgeHearth mouthRef={mouthRef} />
          <Anvil barRef={barRef} />
        </div>
      </section>

      <section className="fl-panel" aria-labelledby="fl-signin">
        <div className="fl-panel-inner">
          <h2 id="fl-signin" className="fl-panel-title">
            Sign in
          </h2>
          <p className="fl-panel-sub">Use your email and password.</p>
          {children}
        </div>
      </section>
    </div>
  );
}

const ANVIL_BODY =
  "M14 58C64 44 112 38 160 38H566L578 44V82L540 92C474 104 446 126 446 166V200C446 222 474 234 522 242L546 262V286H164V262L188 242C236 234 264 222 264 200V166C264 128 236 106 194 98C124 88 64 78 14 58Z";
/** Only the faces the fire below can reach: the horn and heel undersides and
    the waist. Not the ground line, not the top. */
const ANVIL_LIT_EDGES =
  "M540 92C474 104 446 126 446 166V200C446 222 474 234 522 242 M188 242C236 234 264 222 264 200V166C264 128 236 106 194 98C124 88 64 78 14 58";

/**
 * The great anvil, side on: horn to the left, hardy hole near the heel, lit
 * from the forge below and behind. The hot bar on its face is where the strike
 * lands and where the sparks leave from.
 */
function Anvil({ barRef }: { barRef: React.RefObject<SVGRectElement | null> }) {
  return (
    <svg
      className="fl-anvil"
      viewBox="0 0 600 300"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="fl-iron" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2421" />
          <stop offset="0.14" stopColor="#171412" />
          <stop offset="0.62" stopColor="#0c0a09" />
          <stop offset="1" stopColor="#1c0d07" />
        </linearGradient>
        <linearGradient id="fl-rim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e2561b" stopOpacity="0" />
          <stop offset="0.35" stopColor="#ffb43a" stopOpacity="0.9" />
          <stop offset="0.62" stopColor="#ffb43a" stopOpacity="0.9" />
          <stop offset="1" stopColor="#e2561b" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="fl-bar" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8e1b0e" />
          <stop offset="0.22" stopColor="#e2561b" />
          <stop offset="0.5" stopColor="#fff3d6" />
          <stop offset="0.78" stopColor="#ffb43a" />
          <stop offset="1" stopColor="#b3301a" />
        </linearGradient>
        <linearGradient id="fl-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb43a" stopOpacity="0" />
          <stop offset="0.3" stopColor="#e2561b" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ff8a2a" stopOpacity="0.7" />
        </linearGradient>
        <radialGradient id="fl-flash">
          <stop offset="0" stopColor="#fff6e0" stopOpacity="1" />
          <stop offset="0.25" stopColor="#ffb43a" stopOpacity="0.75" />
          <stop offset="1" stopColor="#e2561b" stopOpacity="0" />
        </radialGradient>
        <filter id="fl-blur" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>

      {/* Body, then its edges lit from the fire below */}
      <path fill="url(#fl-iron)" d={ANVIL_BODY} />
      <path
        d={ANVIL_LIT_EDGES}
        fill="none"
        stroke="url(#fl-edge)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* The face plane catching the room light */}
      <path
        d="M160 38H566L578 44V52H150C110 52 70 56 30 60L14 58C64 44 112 38 160 38Z"
        fill="#2c2622"
      />
      {/* Hardy hole */}
      <rect x="512" y="38" width="16" height="7" fill="#070605" />
      {/* Rim light along the face */}
      <path
        d="M20 57C68 44 114 39 160 39H566"
        fill="none"
        stroke="url(#fl-rim)"
        strokeWidth="2"
      />
      {/* The work: glow, then the bar itself */}
      <rect
        className="fl-bar-glow"
        x="262"
        y="20"
        width="200"
        height="16"
        rx="6"
        fill="url(#fl-bar)"
        filter="url(#fl-blur)"
      />
      <rect
        ref={barRef}
        x="262"
        y="22"
        width="200"
        height="15"
        rx="5"
        fill="url(#fl-bar)"
      />
      {/* The strike */}
      <ellipse
        className="fl-shock"
        cx="362"
        cy="30"
        rx="70"
        ry="12"
        fill="none"
        stroke="#ffcf7a"
        strokeWidth="2"
      />
      <circle
        className="fl-flash"
        cx="362"
        cy="26"
        r="150"
        fill="url(#fl-flash)"
      />
    </svg>
  );
}
