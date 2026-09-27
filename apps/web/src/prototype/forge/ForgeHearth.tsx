/**
 * PROTOTYPE — the forge itself: a masonry hearth behind the anvil, its chimney
 * hood rising off the top of the scene and its fire mouth burning. This is the
 * light source the rest of the scene is lit by — the glow, the backlight on the
 * anvil and the embers all come from the mouth.
 *
 * Flames flicker by transform and opacity only; under reduced motion the global
 * rule in index.css collapses them to one still frame.
 */
import type { RefObject } from "react";

const COURSE = 34; // stone course height, in viewBox units

/** Five tongues of flame, [x, height, delay s, duration s]. */
const FLAMES: [number, number, number, number][] = [
  [196, 78, 0, 1.3],
  [226, 118, 0.35, 1.05],
  [252, 142, 0.1, 0.9],
  [280, 110, 0.55, 1.15],
  [306, 72, 0.2, 1.4],
];

/** The coal bed: [cx, cy, rx, ry, hot]. */
const COALS: [number, number, number, number, boolean][] = [
  [168, 552, 18, 8, false],
  [196, 548, 20, 10, true],
  [226, 553, 17, 8, true],
  [254, 546, 22, 11, true],
  [284, 552, 18, 9, true],
  [310, 548, 19, 9, false],
  [334, 553, 16, 7, false],
];

export function ForgeHearth({
  mouthRef,
}: {
  mouthRef: RefObject<SVGPathElement | null>;
}) {
  // Courses on the hood follow its taper; on the body they are straight, with
  // the joints staggered every other course.
  const hoodCourses = Array.from({ length: 8 }, (_, i) => {
    const y = 30 + i * COURSE;
    const half = 80 + (y / 300) * 140;
    return { y, x1: 250 - half, x2: 250 + half };
  });
  const bodyCourses = Array.from({ length: 24 }, (_, i) => 322 + (i + 1) * 36);

  return (
    <svg
      className="fl-hearth"
      viewBox="0 0 500 720"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="fl-hood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b0a09" />
          <stop offset="0.6" stopColor="#161210" />
          <stop offset="1" stopColor="#2a1c15" />
        </linearGradient>
        <radialGradient id="fl-stone-lit" cx="0.5" cy="0.34" r="0.7">
          <stop offset="0" stopColor="#3a2317" />
          <stop offset="0.45" stopColor="#1a1411" />
          <stop offset="1" stopColor="#0d0b0a" />
        </radialGradient>
        <radialGradient id="fl-coals" cx="0.5" cy="0.92" r="0.85">
          <stop offset="0" stopColor="#fff3d6" />
          <stop offset="0.16" stopColor="#ffb43a" />
          <stop offset="0.42" stopColor="#e2561b" />
          <stop offset="0.72" stopColor="#8e1b0e" />
          <stop offset="1" stopColor="#1e0704" />
        </radialGradient>
        <linearGradient id="fl-back-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0e0504" stopOpacity="0.92" />
          <stop offset="0.55" stopColor="#0e0504" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fl-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#fff3d6" />
          <stop offset="0.25" stopColor="#ffb43a" />
          <stop offset="0.7" stopColor="#e2561b" stopOpacity="0.85" />
          <stop offset="1" stopColor="#8e1b0e" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fl-lip" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8a2a" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ff8a2a" stopOpacity="0" />
        </linearGradient>
        <clipPath id="fl-mouth-clip">
          <path d={MOUTH} />
        </clipPath>
      </defs>

      {/* Chimney hood, running up off the top of the scene */}
      <path d="M160 0H340L474 300H26Z" fill="url(#fl-hood)" />
      {hoodCourses.map(({ y, x1, x2 }) => (
        <line
          key={y}
          x1={x1}
          x2={x2}
          y1={y}
          y2={y}
          stroke="#000"
          strokeOpacity="0.4"
          strokeWidth="1.5"
        />
      ))}
      {/* The hood's lip, its underside lit by the fire */}
      <rect x="12" y="296" width="476" height="26" rx="2" fill="#1c1714" />
      <rect
        x="12"
        y="320"
        width="476"
        height="12"
        fill="url(#fl-lip)"
        opacity="0.45"
      />

      {/* The hearth body */}
      {/* Runs on past the viewBox (the svg overflows) down to the floor. */}
      <rect x="40" y="322" width="420" height="900" fill="url(#fl-stone-lit)" />
      {bodyCourses.map((y, i) => (
        <g key={y} stroke="#000" strokeOpacity="0.42" strokeWidth="1.5">
          <line x1="40" x2="460" y1={y} y2={y} />
          {[0, 1, 2, 3].map((j) => {
            const x = 40 + (i % 2 ? 52 : 104) + j * 104;
            return x < 460 ? (
              <line key={j} x1={x} x2={x} y1={y - 36} y2={y} />
            ) : null;
          })}
        </g>
      ))}

      {/* The fire mouth */}
      <path ref={mouthRef} d={MOUTH} fill="url(#fl-coals)" />
      <g clipPath="url(#fl-mouth-clip)">
        <rect
          x="130"
          y="320"
          width="240"
          height="240"
          fill="url(#fl-back-wall)"
        />
        {FLAMES.map(([x, h, delay, duration]) => (
          <path
            key={x}
            className="fl-flame"
            style={{
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
            }}
            d={`M${x} 556C${x - 22} ${556 - h * 0.35} ${x - 10} ${556 - h * 0.7} ${x + 3} ${556 - h}C${x + 8} ${556 - h * 0.62} ${x + 24} ${556 - h * 0.34} ${x} 556Z`}
            fill="url(#fl-flame)"
          />
        ))}
        {COALS.map(([cx, cy, rx, ry, hot]) => (
          <ellipse
            key={cx}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill={hot ? "#ffb43a" : "#b3301a"}
            opacity={hot ? 0.9 : 0.75}
          />
        ))}
      </g>
      {/* Voussoirs: the arch stones, their inner faces lit */}
      <path
        d="M130 560V440A120 120 0 0 1 370 440V560"
        fill="none"
        stroke="#ff8a2a"
        strokeOpacity="0.55"
        strokeWidth="3"
      />
      <path
        d="M112 560V440A138 138 0 0 1 388 440V560"
        fill="none"
        stroke="#241c18"
        strokeWidth="16"
      />
      {/* The firepot ledge the coals sit on */}
      <rect x="104" y="560" width="292" height="16" fill="#241b17" />
      <rect
        x="104"
        y="560"
        width="292"
        height="3"
        fill="#ff8a2a"
        opacity="0.6"
      />
    </svg>
  );
}

const MOUTH = "M130 560V440A120 120 0 0 1 370 440V560Z";
