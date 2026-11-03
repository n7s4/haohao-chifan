/**
 * 确定性 id：同一个业务键永远得到同一个 uuid 字符串。
 * meal_plan_entries 的 live 唯一索引是部分索引（where deleted = false），
 * PostgREST 的 upsert 无法推断它，所以 plan 一律用主键 id 做冲突目标。
 */

function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a: number, b: number, c: number, d: number) {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
}

const hex = (value: number) => value.toString(16).padStart(8, "0");

/** 生成 v4 形状的 uuid；同一组 parts 结果恒定。 */
export function deterministicId(...parts: string[]): string {
  const seed = xmur3(parts.join("\u0000"));
  const rand = sfc32(seed(), seed(), seed(), seed());
  const raw = `${hex(rand())}${hex(rand())}${hex(rand())}${hex(rand())}`;
  const variant = ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16);
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    `4${raw.slice(13, 16)}`,
    `${variant}${raw.slice(17, 20)}`,
    raw.slice(20, 32),
  ].join("-");
}

export function planEntryId(userId: string, dayKey: string, slot: string): string {
  return deterministicId("meal_plan_entries", userId, dayKey, slot);
}
