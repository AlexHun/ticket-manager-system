// The slice of `bun:sqlite` that `./usage-store.ts` opens the history with, and
// nothing more.
//
// `apps/web` declares no Bun types, and `@types/bun` would be a new dependency
// for a constructor and six methods (#417 asks before adding one, and names
// this as the alternative). It is a hand-written mirror of a
// third-party shape, so it carries only what the opener calls — a member added
// here that Bun does not have would compile and throw at the first scan. Bun's
// own docs are the reference: https://bun.sh/docs/api/sqlite.

declare module "bun:sqlite" {
  /** A prepared statement. Parameters are positional, as `?` placeholders. */
  export class Statement {
    run(...params: Array<string | number | null>): unknown;
    /** `null`, not `undefined`, when there is no row — the one difference from
     *  `node:sqlite` the store's adapter has to normalise. */
    get(...params: Array<string | number | null>): unknown;
    all(...params: Array<string | number | null>): unknown[];
  }

  export class Database {
    /** Creates the file when it does not exist, which is Bun's default. */
    constructor(filename: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
}
