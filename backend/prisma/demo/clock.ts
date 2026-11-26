/**
 * A settable clock for the demo loader. While set, `new Date()` and `Date.now()` return the demo
 * time, so the app's own services stamp a step (award time, delivery time, quote deadline...) as if
 * it happened then. Every Date is still a real Date (same prototype), so nothing else notices.
 */
export const RealDate = Date;
let virtual: number | null = null;

export function installClock() {
  function ClockDate(this: unknown, ...args: unknown[]) {
    if (!new.target) return RealDate();
    if (args.length === 0 && virtual != null) return new RealDate(virtual);
    return new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
  }
  ClockDate.prototype = RealDate.prototype;
  ClockDate.now = () => virtual ?? RealDate.now();
  ClockDate.parse = RealDate.parse;
  ClockDate.UTC = RealDate.UTC;
  (globalThis as unknown as { Date: unknown }).Date = ClockDate;
}

export const setClock = (ms: number | null) => {
  virtual = ms;
};
