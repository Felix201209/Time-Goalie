export function focusAfterPaint(target) {
  queueMicrotask(() => {
    window.requestAnimationFrame(() => {
      if (typeof target === "function") {
        target();
        return;
      }
      if (target?.isConnected) target.focus();
    });
  });
}
