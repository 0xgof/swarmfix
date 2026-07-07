/**
 * Minimal ambient declarations for the Node built-ins used by test-time
 * fixture generation (uwbSelectionParityFixtures.test.ts).
 *
 * The viewer intentionally does not depend on `@types/node`; only a couple of
 * test files touch the filesystem to regenerate committed parity fixtures.
 * These narrow shims keep `tsc --noEmit` (run by `npm run build`) green
 * without pulling in the full Node type surface.
 */

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};

declare module "node:fs" {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string): void;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function resolve(...segments: string[]): string;
}
