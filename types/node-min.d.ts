// Minimal type descriptions for the few Node.js built-ins CodePDF uses.
// Written by hand instead of installing @types/node, to keep dependencies small.
// Anything not listed here can't be used without the compiler complaining.

declare const process: {
  readonly platform: string;
  readonly env: Record<string, string | undefined>;
};

declare function setTimeout(callback: () => void, ms?: number): unknown;
declare function clearTimeout(handle: unknown): void;

declare const console: {
  log(...values: unknown[]): void;
};

/** Folder of the running compiled file (used by tests to find fixtures). */
declare const __dirname: string;

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare module "node:fs" {
  interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: Uint8Array | string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function resolve(...parts: string[]): string;
}

declare module "node:crypto" {
  export function randomBytes(size: number): { toString(encoding: "base64" | "hex"): string };
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:test" {
  type TestFn = () => void | Promise<void>;
  export function test(name: string, fn: TestFn): Promise<void>;
  export function describe(name: string, fn: () => void): void;
}

declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    match(value: string, regExp: RegExp, message?: string): void;
    doesNotMatch(value: string, regExp: RegExp, message?: string): void;
    throws(fn: () => unknown, message?: string): void;
    rejects(fn: () => Promise<unknown>, message?: string): Promise<void>;
  }
  const assert: Assert;
  export default assert;
}
