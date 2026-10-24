import { BRAND_ATTRIBUTIVE, BRAND_NAME } from "@ticket/shared";
import { withoutDashes } from "./provider";

/**
 * The auto-reply's text: the model's paragraphs, its steps and the customer's
 * display name, turned into the finished reply, or into nothing.
 *
 * **The model does not write the whole reply.** It returns body paragraphs and,
 * if there are any, steps; the greeting, the numbering and the sign off are
 * assembled here. Asked in the prompt for a first-name greeting and a
 * support-team sign off, the model gave neither reliably — the first measured
 * reply opened "Hi Marta" mid-paragraph and simply stopped at the end with no
 * sign off at all. Written in code they are facts.
 *
 * It also closes a hole rather than merely tidying one. The name is the *email's
 * From display name*, which is chosen by whoever sent the mail, and it used to be
 * interpolated into the prompt outside the fence. Now it never reaches the model
 * at all: `greetingName` reduces it to a single plausible name token or drops it,
 * and it is placed straight into the greeting line.
 *
 * One exported function, so the order of the passes is this module's alone:
 * flatten, strip the bookends the model wrote anyway, in its paragraphs
 * (`withoutBookends`) and its steps (`withoutStepBookends`), add ours and number
 * the steps (`composeReply`), then take every em and en dash out of the
 * assembled text. It was inside `autoReply` until #572, where every test of a
 * string transform had to script a model call to reach it.
 *
 * Nothing here is a safety check. The length limit and checks 4-6 stay in
 * `autoReply`; the length limit and checks 5 and 6 run over exactly the string
 * this returns, greeting and sign off included (ADR-0004).
 */

/**
 * How the reply opens and closes.
 *
 * Fixed text, written here rather than asked for, so every customer gets the
 * same courtesy in the same words. `Hello,` is the fallback when there is no
 * usable first name — a greeting with a blank where a name should be reads worse
 * than no name, and inventing one is not an option.
 *
 * The sign off deliberately carries no personal name, no agent handle and no
 * contact details. A name would be a lie; an address or a URL here would be
 * worse than a lie, because `unbackedReferences` in `autoReply` runs over the
 * assembled reply and would discard every single one of these for citing a
 * link no article contains. If a future sign off needs contact details, they
 * belong in an article first. It signs as the product, `BRAND_NAME`, as the
 * invitation and reset emails do (#488); the name carries no money word, link
 * or address, so checks 5 and 6 pass it as they passed "The Support Team".
 */
const GREETING_FALLBACK = "Hello,";
const SIGN_OFF = `Best regards,\n${BRAND_NAME}`;

/**
 * What may be used as a first name.
 *
 * Letters, apostrophes and hyphens, one token, and short. This is a security
 * boundary rather than a formatting nicety: the string it filters is the From
 * display name of an email from a stranger, and it is about to be copied
 * verbatim into a reply that one day gets sent. Anything that is not obviously
 * a name is dropped in favour of `GREETING_FALLBACK`, because addressing a real
 * customer as "Hello," costs nothing and the alternative is pasting whatever
 * someone put in that header into the desk's own voice.
 *
 * `\p{L}` rather than `a-z`: this rejects payloads, not people, and a customer
 * called Ünal or Łukasz is a customer.
 */
const NAME_TOKEN = /^[\p{L}][\p{L}'’-]*$/u;
const NAME_LIMIT = 40;

/**
 * A first name we are willing to put in a greeting, or null.
 *
 * Takes the first whitespace-separated token of the display name and nothing
 * else, so "Marta Vogel" greets Marta and "Marta, urgent: visit https://…" also
 * greets Marta: the payload is in tokens we never look at. "https://evil.example
 * is down" greets nobody, because its first token is not a name.
 *
 * Surrounding punctuation is trimmed before the test rather than after, so the
 * "Vogel, Marta" form some clients send is not thrown away over its comma. That
 * trimming is why the first example keeps its name rather than losing it to the
 * comma — the outcome that matters is the same either way, which is that nothing
 * but one plausible name token can reach the greeting line.
 *
 * The case is left exactly as it arrived. Title-casing would be presumptuous:
 * plenty of people write their own name in lower case on purpose, and "hi marta"
 * is a smaller discourtesy than correcting somebody's name for them.
 */
function greetingName(customerName: string): string | null {
  const first = (customerName.trim().split(/\s+/)[0] ?? "").replace(
    /^[^\p{L}]+|[^\p{L}'’-]+$/gu,
    "",
  );
  if (first.length === 0 || first.length > NAME_LIMIT) return null;
  return NAME_TOKEN.test(first) ? first : null;
}

/** One block of prose on one line: the layout is ours, not the model's. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Openings and closings the model was told not to write, in case it did.
 *
 * The word must end where a word ends, not at a hyphen or an apostrophe:
 * "Hi-res video - set it to Auto" is a sentence, and with `\b` it read as "Hi"
 * closed by the spaced hyphen, and lost "Hi-res video".
 */
const GREETING_LINE =
  /^(hi|hello|hey|dear|greetings|good\s+(morning|afternoon|evening|day))(?![\w'’-])/i;

/** The dash glyphs: a hyphen, an en dash and an em dash, as a class body. */
const DASH_GLYPHS = "-–—";

/**
 * A dash the model may put where a comma or a bullet would go: "— The Support
 * Team", "Hi Marta — buffering…", a step "– Set the quality to Auto", or the
 * "-- " that opens an email signature. A pattern source, built from
 * `DASH_GLYPHS` like the other dash patterns that treat all three alike, so
 * they cannot drift apart. `GREETING_PREFIX` and `SENTENCE_DASH` close on a
 * hyphen only beside a space, and say why they spell the glyphs out.
 *
 * The strips anchor on a bookend's first word, or close a greeting on its
 * punctuation, so a dash hid a bookend from them, and `withoutDashes` runs last,
 * over the assembled text. Running it first instead was measured and lost: it
 * turns "…closer look. — Best regards" into "…closer look., Best regards",
 * which `TRAILING_SIGN_OFF` no longer matches. So the strips learn the dash
 * (#547 for sign offs, #573 for greetings and steps).
 */
const DASH = `[${DASH_GLYPHS}]{1,2}`;

/**
 * The greeting itself, up to and including what closes it: a comma, a full
 * stop, a colon or a dash.
 *
 * The 30-character ceiling is the whole safety of this function, and it was put
 * there after watching the unbounded version eat a sentence: "Hi there is a
 * setting in the player that controls this." opens with a word `GREETING_LINE`
 * matches, and a pattern allowed to run to the first full stop consumed all of
 * it and left an empty paragraph. A greeting is "Hi Marta," — short, and over
 * long before any real sentence has finished.
 *
 * An en or em dash closes it wherever it sits, "Hi Marta—buffering" included.
 * A hyphen closes it only with space before it and space or the end after, so
 * "Hi Anne-Marie," is still closed by its comma. That split is why the hyphen
 * is spelled apart from the other two here rather than read from `DASH`. Lazy,
 * so the first closer wins.
 */
const GREETING_PREFIX =
  /^[^,.!?:–—]{0,30}?(?:[,.:!?]|\s*[–—]{1,2}|\s+-{1,2}(?=\s|$))\s*/;
const GREETING_MAX = 30;

/**
 * How long a paragraph may be and still be treated as nothing but a sign off.
 *
 * Also a guard against eating content rather than a formatting nicety. "Thanks"
 * and "thank you" have to be in `SIGN_OFF_LINE` because the model closes with
 * them, but they also open perfectly good sentences — "Thanks for letting us
 * know, that helps us track it down." matched, and at the 80 characters this
 * used to allow it was discarded. Forty, measured after trailing punctuation,
 * keeps every real closer and no real sentence.
 */
const SIGN_OFF_MAX = 40;
const SIGN_OFF_LINE =
  /^(kind|best|warm)\s+(regards|wishes)\b|^(regards|sincerely|cheers|thanks|thank\s+you)\b|^(the\s+)?support\s+team\b|^yours\s+(sincerely|faithfully|truly)\b/i;

/**
 * A paragraph that is the product's name and nothing else, "The" optional.
 *
 * Our own sign off has signed as `BRAND_NAME` since #488, so it is the
 * signature a model copying it would write, and without this the strip below
 * stopped at that line and left the "Best regards," above it in place: two
 * sign offs (#513). Built from `BRAND_ATTRIBUTIVE`, the name less its article,
 * rather than typed out again, so a rename cannot leave it matching the old
 * name.
 *
 * Anchored at both ends, unlike `SIGN_OFF_LINE`, and tested against the
 * paragraph with its trailing punctuation off: "<the name> saves it for you."
 * opens with the name and is a sentence, not a signature. Because nothing but
 * the name can match, `SIGN_OFF_MAX` does not apply to it, so a longer name
 * one day is still stripped.
 */
const BRAND_SIGN_OFF = new RegExp(
  `^(?:the\\s+)?${BRAND_ATTRIBUTIVE.split(/\s+/).map(escapeRegExp).join("\\s+")}$`,
  "i",
);

/** `text` as a pattern that matches only itself. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A sign off welded onto the end of the last real sentence.
 *
 * The variant `SIGN_OFF_LINE` cannot see, and the one actually observed: the
 * model ended a paragraph "…and we can take a closer look. Best regards, Support
 * Team" rather than putting the closer in an entry of its own. Left alone that
 * ships two sign offs, the wrong one first.
 *
 * Anchored to sentence-ending punctuation, which is kept, and deliberately
 * narrower than `SIGN_OFF_LINE`: only the formal closers. "Thanks" and "thank
 * you" are missing on purpose, because "…and thank you for your patience." is a
 * legitimate way to end a support reply and this would eat it.
 *
 * The closer may be led by a `DASH`, "…closer look. — Best regards", for the
 * reason that constant gives.
 */
const TRAILING_SIGN_OFF = new RegExp(
  String.raw`([.!?])\s+(?:${DASH}\s*)?(?:(?:kind|best|warm)\s+(?:regards|wishes)|regards|sincerely|cheers|yours\s+\w+)\b[\s\S]*$`,
  "i",
);

/**
 * Whatever follows the first dash after a sentence's end, to the end of the
 * paragraph, tested as a sign off.
 *
 * `TRAILING_SIGN_OFF` leaves out "Thanks", "Thank you", the support team and the
 * product's name, because a sentence may end with them. After a dash they are
 * set apart from the sentence as a closer is, so "…closer look. — Thanks!" is
 * cut, and by the same test, `isSignOff`, as a paragraph of its own.
 */
const DASHED_TAIL = new RegExp(String.raw`([.!?])\s+${DASH}\s*([\s\S]*)$`);

/**
 * A paragraph's leading `DASH`, looked past only to test it.
 *
 * Never cut from a paragraph that is kept, so a body sentence that opens with a
 * dash goes out as it was written.
 */
const LEADING_DASH = new RegExp(String.raw`^${DASH}\s*`);

/** A paragraph that is a dash and nothing else: a separator. */
const DASH_ONLY = new RegExp(`^[${DASH_GLYPHS}]+$`);

/**
 * A dash after a sentence's end, inside a paragraph that is kept.
 *
 * `withoutDashes` turns any en or em dash into a comma, and after a full stop
 * that is a stray one: "…setting. — Thanks for your patience…" went out as
 * "…setting., Thanks for…". Here the dash goes and the full stop stays. A
 * hyphen needs space after it, so "-5" is left alone, which is why the glyphs
 * are spelled here rather than read from `DASH`. Run after the strips, which
 * read the dash to find a welded sign off.
 */
const SENTENCE_DASH = /([.!?])\s+(?:[–—]{1,2}\s*|-{1,2}\s+)/g;

/** `text` with every dash after a sentence's end taken out. */
function withoutSentenceDashes(text: string): string {
  return text.replace(SENTENCE_DASH, "$1 ");
}

/** The bullet, dash or number a step was led by, which the numbering replaces. */
const STEP_MARKER = new RegExp(String.raw`^(?:${DASH}|[*•]|\d+[.)])\s*`);

/** Punctuation, dashes and space at the end of a line. */
const TRAILING_PUNCTUATION = new RegExp(`[${DASH_GLYPHS}.,;:!?\\s]+$`);

/**
 * Whether `text` is a sign off and nothing else, a leading dash looked past.
 *
 * Trailing punctuation and dashes are off before the length test and the brand
 * test, so "Best regards, —" is a closer and the product's name with a full
 * stop after it is a signature.
 */
function isSignOff(text: string): boolean {
  const line = text.replace(LEADING_DASH, "");
  const bare = line.replace(TRAILING_PUNCTUATION, "");
  return (
    (bare.length <= SIGN_OFF_MAX && SIGN_OFF_LINE.test(line)) ||
    BRAND_SIGN_OFF.test(bare)
  );
}

/**
 * What follows the greeting `text` opens with, a leading dash looked past: ""
 * when the greeting is the whole of it, null when there is no greeting.
 *
 * A greeting closed by `GREETING_PREFIX` leaves whatever came after it. One it
 * cannot close is the whole line only while the line is short enough to be
 * nothing but an unpunctuated greeting; past that the line only *starts* with
 * a greeting word, and is no greeting at all.
 */
function afterGreeting(text: string): string | null {
  const line = text.replace(LEADING_DASH, "");
  if (!GREETING_LINE.test(line)) return null;
  const rest = line.replace(GREETING_PREFIX, "");
  if (rest !== line) return rest;
  return line.length <= GREETING_MAX ? "" : null;
}

/**
 * `text` with its first letter upper-cased, so the seam where a greeting was
 * cut off does not show.
 */
function recapitalised(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

/**
 * Take out the greeting and sign off the model added anyway.
 *
 * It was asked twice not to, which — as everything in `auto-reply.ts` records —
 * is not the same as it not doing so. Without this the customer gets "Hi Marta,"
 * twice, and the doubled version is the one that looks automated.
 *
 * The length guards are what keep this from eating real sentences. "Thanks for
 * letting us know, that helps us track it down" opens a perfectly good paragraph
 * and matches `SIGN_OFF_LINE`; a sign off is a fragment, so only short entries
 * are considered. A greeting is stripped only from the first paragraph and only
 * when the paragraph continues past it, or when it is the whole of a short one.
 */
function withoutBookends(paragraphs: string[]): string[] {
  const kept = [...paragraphs];

  // A leading dash is looked past to find the greeting, "— Hi Marta,", and kept
  // when there is none, as `LEADING_DASH` says. Whatever follows the greeting on
  // the same line is the start of the real paragraph and is kept, recapitalised:
  // "Hi Marta,\n\nbuffering is usually…" is a worse sentence than the one the
  // model wrote, and the seam should not show.
  const rest = kept.length > 0 ? afterGreeting(kept[0]!) : null;
  if (rest === "") kept.shift();
  else if (rest !== null) kept[0] = recapitalised(rest);

  while (kept.length > 0 && isSignOff(kept[kept.length - 1]!)) kept.pop();
  return withoutWeldedSignOff(kept);
}

/**
 * `blocks` with a sign off welded onto the end of the last one cut, by
 * `DASHED_TAIL` and `TRAILING_SIGN_OFF`, and the block dropped when nothing is
 * left of it.
 *
 * One function for the last paragraph and the last step, so the two strips
 * cannot drift apart: the step had no such cut until #645, and "1. Set the
 * quality to Auto. Best regards" shipped with ours after it.
 */
function withoutWeldedSignOff(blocks: string[]): string[] {
  const kept = [...blocks];
  const tail = kept[kept.length - 1];
  if (tail === undefined) return kept;
  const dashed = DASHED_TAIL.exec(tail);
  const undashed =
    dashed !== null && isSignOff(dashed[2]!)
      ? tail.slice(0, dashed.index) + dashed[1]!
      : tail;
  const trimmed = undashed.replace(TRAILING_SIGN_OFF, "$1").trim();
  if (trimmed.length > 0) kept[kept.length - 1] = trimmed;
  else kept.pop();
  return kept;
}

/**
 * A signature that may follow a closer in a step: the support team, or the
 * product's name.
 */
const STEP_SIGNATURE = /^(?:the\s+)?support\s+team$/i;

/**
 * Whether a step is a sign off and nothing else: a closer `SIGN_OFF_LINE`
 * names, then nothing or a signature, or the product's name alone.
 *
 * Stricter than `isSignOff`, whose `SIGN_OFF_MAX` tells a closer from a
 * sentence by length. A step is as short as a closer, so "Support team can
 * reset it for you" passed that test and would have gone, taking with it the
 * only thing the customer was told to do.
 */
function isStepSignOff(step: string): boolean {
  const closer = SIGN_OFF_LINE.exec(step);
  const after = (closer === null ? step : step.slice(closer[0].length))
    .replace(/^[\s,.;:!?]+/, "")
    .replace(TRAILING_PUNCTUATION, "");
  if (closer === null) return BRAND_SIGN_OFF.test(after);
  return (
    after.length === 0 ||
    STEP_SIGNATURE.test(after) ||
    BRAND_SIGN_OFF.test(after)
  );
}

/**
 * Take out a greeting the model put in its first step and the sign offs it made
 * its last ones (#635).
 *
 * Numbered, either one shipped as a step with ours beside it: two greetings or
 * two sign offs in one reply. A greeting is cut from the first step as from the
 * first paragraph, so "Hi Marta, set the quality to Auto" keeps its instruction
 * and "Hi-res video: set it to Auto" is no greeting at all. A sign off goes
 * when it is the whole step, by `isStepSignOff`, or when it is welded onto the
 * end of the last one, by the cut the last paragraph gets (#645).
 */
function withoutStepBookends(steps: string[]): string[] {
  const kept = [...steps];
  const rest = kept.length > 0 ? afterGreeting(kept[0]!) : null;
  if (rest === "") kept.shift();
  else if (rest !== null) kept[0] = recapitalised(rest);
  while (kept.length > 0 && isStepSignOff(kept[kept.length - 1]!)) kept.pop();
  return withoutWeldedSignOff(kept);
}

/**
 * The finished reply, as it will sit in the thread and one day in an inbox.
 *
 * Blank lines between blocks and numbered steps, because this is plain text
 * email: there is no renderer downstream to turn markdown into layout, so the
 * layout has to survive being read literally in a mail client. Steps sit after
 * the opening paragraph, which is where an answer that begins "this is usually
 * X" wants them; anything the model wrote after that follows the list.
 *
 * Returns null when there is nothing left to send — which happens when the model
 * answered with a greeting and a sign off and no actual content, and is treated
 * upstream exactly like any other empty reply.
 */
function composeReply(
  name: string | null,
  paragraphs: string[],
  steps: string[],
): string | null {
  const body = withoutBookends(
    paragraphs
      .map(flatten)
      // A dash on its own is a separator, "--" above a signature, not content.
      .filter((p) => p.length > 0 && !DASH_ONLY.test(p)),
  ).map(withoutSentenceDashes);
  const actions = withoutStepBookends(
    steps
      // The prompt says the numbering is ours; strip it when it arrives anyway,
      // or the customer reads "1. 1. Try a different browser". A dash leads a
      // step as a bullet does, and left on it reads "1., Set the quality".
      .map((step) => flatten(step).replace(STEP_MARKER, ""))
      .filter((step) => step.length > 0),
  );

  if (body.length === 0 && actions.length === 0) return null;

  const blocks = [name === null ? GREETING_FALLBACK : `Hi ${name},`];

  if (body.length > 0) blocks.push(body[0]!);
  if (actions.length > 0) {
    blocks.push(actions.map((step, i) => `${i + 1}. ${step}`).join("\n"));
  }
  blocks.push(...body.slice(1));
  blocks.push(SIGN_OFF);

  return blocks.join("\n\n");
}

/**
 * The finished reply, or null when nothing is left to send.
 *
 * `customerName` is the From display name as it arrived, untrusted; only what
 * `greetingName` makes of it reaches the text. The dash pass runs last, over the
 * assembled reply, so a dash in our own fixed text could never ship either.
 */
export function shapeReply(
  customerName: string,
  paragraphs: string[],
  steps: string[],
): string | null {
  const composed = composeReply(greetingName(customerName), paragraphs, steps);
  return composed === null ? null : withoutDashes(composed);
}
