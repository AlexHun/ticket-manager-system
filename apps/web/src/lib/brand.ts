/**
 * The product's name, in its two lengths.
 *
 * `BRAND_NAME` is what the lockup reads and what every sentence says;
 * `BRAND_SHORT` is for where space is tight, which today is only the browser
 * tab. `index.html` carries the short form as a literal, because the static
 * shell is read before any module runs — `tests/e2e/brand.spec.ts` holds the
 * two together.
 *
 * Import-free, like `routes.ts`, so the E2E suite can reach into it rather than
 * restating the strings it asserts.
 */
export const BRAND_NAME = "The Great Forge Desk";
export const BRAND_SHORT = "Forge Desk";
