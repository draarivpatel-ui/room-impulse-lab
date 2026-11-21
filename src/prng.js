/* Deterministic random numbers. Pure ES module, shared by the engine and the
 * stochastic tail generator so every run and every test is repeatable. */

/** mulberry32: 32 bit state, deterministic, uniform in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller Gaussian sampler on top of a uniform source. */
export function normalSampler(rand) {
  let spare = null;
  return function normal(mean = 0, sd = 1) {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return mean + sd * v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * v;
    spare = r * Math.sin(th);
    return mean + sd * r * Math.cos(th);
  };
}
