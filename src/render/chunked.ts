/**
 * Runs a step generator in slices of at most ~budgetMs, yielding to the event loop in
 * between, so long renders don't block the main thread. Stops early once isCancelled().
 */
export async function runChunked(
  steps: Iterator<void>,
  isCancelled: () => boolean = () => false,
  budgetMs = 8,
): Promise<void> {
  for (;;) {
    const start = performance.now();
    while (performance.now() - start < budgetMs) {
      if (steps.next().done) return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (isCancelled()) return;
  }
}
