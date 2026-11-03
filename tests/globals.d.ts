declare module 'node:test' {
  function test(name: string, fn: () => void | Promise<void>): void;
  export { test };
  export default test;
}

declare module 'node:assert/strict' {
  interface StrictAssert {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(actual: string, expected: RegExp, message?: string): void;
    rejects(block: () => Promise<unknown>, error?: (reason: unknown) => boolean): Promise<void>;
  }
  const assert: StrictAssert;
  export default assert;
}
