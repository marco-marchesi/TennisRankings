/**
 * Safe process exit for scraper entrypoints.
 *
 * Calling `process.exit()` immediately after the last database query trips a
 * libuv assertion on Windows:
 *
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c
 *
 * The process then returns 0xC0000409 (3221226505). Nothing is actually wrong
 * - the work completed and the rows were written - but a scheduled task reads
 * that as a failed run, which is exactly the kind of false alarm that trains
 * you to ignore the alarm. Observed on scrape-atp-results, verify-data and
 * merge-duplicate-players.
 *
 * Yielding a tick lets the HTTP keep-alive sockets finish closing first.
 */
export function finish(code = 0): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 200);
}

/** Standard terminal handler: `main().then(...ok(), ...fail())`. */
export function runEntrypoint(promise: Promise<unknown>): void {
  promise.then(
    // process.exitCode is typed string | number | undefined (a string is
    // legal for named exit codes), so normalise before handing it back.
    () => finish(typeof process.exitCode === "number" ? process.exitCode : 0),
    (err) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : err);
      finish(1);
    },
  );
}
