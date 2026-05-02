/**
 * Wraps a promise with a hard timeout.
 *
 * The rejection message always contains "timeout NNNms" so
 * orchestrator/classify.ts can distinguish it from other errors.
 */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`${label}: timeout ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
