/**
 * The welcome's names a test reaches for: the page heading, its four sections'
 * headings, the control that leaves it and the banner's link back
 * (demo-welcome PRD, R1, R2, R3, R4, R5, R6, R7).
 *
 * Import-free, like `routes.ts`, so `tests/e2e/demo-welcome.spec.ts` imports
 * them rather than restating them — a retyped label would leave the spec
 * looking for a control that no longer exists.
 */
export const WELCOME_LABEL = {
  title: "Welcome to the demo",
  howHeading: "How a ticket travels",
  stepsHeading: "Where to start",
  ownerHeading: "Who built it",
  stackHeading: "What it is built with",
  startExploring: "Start exploring",
  bannerLink: "About this demo",
} as const;

/** A link off the site: its visible name and where it goes. */
export interface WelcomeLink {
  readonly name: string;
  readonly href: string;
}

/**
 * The owner the welcome introduces (R3): name, role, a short bio and three
 * ways to reach them. The bio is drafted from the owner's CV, which is never
 * committed, and its facts are the ones `docs/linkedin/profile.md` transcribes
 * from it. No phone number and no address, by the PRD's decision.
 */
export const WELCOME_OWNER = {
  name: "Aliaksei Hunich",
  role: "AI Full-Stack Developer, former frontend team lead",
  bio: [
    "I spent fourteen years at one B2B software company, the last five of them leading six frontend developers on a cloud platform for media agencies. We took it from Angular 13 to 20 and cut its production bundle from 12 MB to under 5 MB.",
    "Since May 2026 I have been building LLM applications in TypeScript. This desk began as a course project that month, and I have built it out since. I am looking for a role as an AI full-stack developer or senior frontend engineer in the EU.",
  ],
  links: [
    {
      name: "LinkedIn",
      href: "https://www.linkedin.com/in/aliaksei-hunich",
    },
    { name: "GitHub", href: "https://github.com/AlexHun" },
    { name: "alex.hunich@gmail.com", href: "mailto:alex.hunich@gmail.com" },
  ],
} as const satisfies {
  name: string;
  role: string;
  bio: readonly string[];
  links: readonly WelcomeLink[];
};

/** The stack in one line (R5), as `tech-stack.md` records it. */
export const WELCOME_STACK =
  "TypeScript throughout: React, Vite and Tailwind with shadcn/ui in front; Express and Prisma on Bun, Postgres with pg-boss for jobs, Postmark for email and OpenAI's gpt-5-nano through the Vercel AI SDK behind it; all hosted on Railway.";

/** The public repository the stack line links to (R5). */
export const WELCOME_REPOSITORY = {
  name: "Read the source on GitHub",
  href: "https://github.com/AlexHun/ticket-manager-system",
} as const satisfies WelcomeLink;
