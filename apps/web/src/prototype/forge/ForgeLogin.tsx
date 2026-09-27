/**
 * PROTOTYPE — the forge login scene. Wraps the real sign-in form (passed as
 * `children`) so every behaviour of LoginPage is unchanged; only the frame is
 * new.
 *
 * The lockup is the whole scene: THE GREAT / FORGE / DESK, lit from a forge
 * that stays off-screen below. The word itself is the work — the strike lands
 * on it.
 *
 * The sequence: the page opens nearly dark, the hammer lands on FORGE (flash
 * behind the letters, a shockwave, a short shake, sparks thrown off the word),
 * and it flashes white-hot and cools through yellow, orange and cherry to lit
 * iron. Then it settles: the glow breathes, embers drift up, the form never
 * moves.
 *
 * Reduced motion skips straight to the cooled frame: no strike, no embers, no
 * shake — the glow and the lit wordmark stay, because reduced motion means no
 * movement, not no identity.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { ForgeEmbers, type Burst } from "./ForgeEmbers";
import { ForgeMark } from "./ForgeMarks";
import "./forge-login.css";

const STRIKE_AT_MS = 650;

type Phase = "dark" | "struck" | "cold";

export function ForgeLogin({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("dark");
  const [burst, setBurst] = useState<Burst | null>(null);
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (reduced) {
      setPhase("cold");
      return;
    }
    const timer = window.setTimeout(() => {
      setPhase("struck");
      const word = wordRef.current?.getBoundingClientRect();
      if (word)
        setBurst({
          x: word.left + word.width / 2,
          y: word.top + word.height * 0.55,
          width: word.width,
          key: Date.now(),
        });
    }, STRIKE_AT_MS);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  return (
    <div className={`fl-root is-${phase}`}>
      <div className="fl-glow" aria-hidden="true" />
      <div className="fl-glow-flare" aria-hidden="true" />
      {!reduced && <ForgeEmbers burst={burst} />}

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
            <span className="fl-word" ref={wordRef} aria-hidden="true">
              <span className="fl-flash" />
              <span className="fl-shock" />
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
