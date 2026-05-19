export function createDebouncedSaver(saveFn, delay = 300) {
  let timer = 0;
  let latestPlan = null;
  let latestFailureHandler = null;
  const timers = globalThis;

  const run = () => {
    timer = 0;
    if (!latestPlan) return true;
    const saved = saveFn(latestPlan);
    if (!saved) latestFailureHandler?.();
    return saved;
  };

  return {
    schedule(plan, onFailure) {
      latestPlan = plan;
      latestFailureHandler = onFailure;
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(run, delay);
    },
    flush() {
      if (timer) timers.clearTimeout(timer);
      return run();
    },
    cancel() {
      if (timer) timers.clearTimeout(timer);
      timer = 0;
    },
  };
}
