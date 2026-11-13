/**
 * 配额落库而不是计数在内存：Edge Function 多实例、冷启动即清零。
 * 每日上限（20）写在 SQL 的 bump_import_usage() 里，不做成入参——客户端拨不动。
 *
 * 三种失败要分开：`bump_import_usage()` 里 `auth.uid()` 是空时返回 -1，
 * 那是调用方身份没传到位（拿了 service_role 的 client 就会这样）——必须
 * fail-closed，否则限流静默失效。真正的网络抖动/5xx 才 fail-open。
 *
 * 注意这里用**调用方 JWT**建请求（Authorization 透传），不能用 service key：
 * 在 service_role 下 `auth.uid()` 是 null，函数会把每次都判成越权。
 */
export type QuotaVerdict = "ok" | "limited" | "unauthorized" | "degraded";

export async function consumeQuota(auth: string): Promise<QuotaVerdict> {
  const base = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!base || !anon) return "degraded";
  try {
    const response = await fetch(`${base}/rest/v1/rpc/bump_import_usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: auth,
      },
      body: "{}",
    });
    if (response.status === 401 || response.status === 403) {
      console.warn("quota rpc unauthorized", response.status);
      return "unauthorized";
    }
    if (!response.ok) {
      // 42501 = insufficient_privilege，和「函数不存在 / 表没建」都归到这里：
      // 前者是身份问题，后者是部署问题，两者都不该悄悄放行。
      const detail = (await response.text()).slice(0, 200);
      console.warn("quota rpc failed", response.status, detail);
      return detail.includes("42501") ? "unauthorized" : "degraded";
    }
    const remaining = await response.json();
    if (typeof remaining !== "number") return "degraded";
    if (remaining === -1) return "unauthorized";
    return remaining === 0 ? "limited" : "ok";
  } catch (problem) {
    console.warn("quota rpc threw", String(problem).slice(0, 200));
    return "degraded";
  }
}

/**
 * 失败时把刚才扣的那一次退回去：用户粘错三段笔记不该少三次机会。
 *
 * 走 service_role 而不是调用方 JWT —— `refund_import_usage` 只 grant 给 service_role，
 * 否则用户能自己反复退款把 count 清零，限流就等于没有。user_id 这里来自已验证的 JWT。
 */
export async function refundQuota(userId: string): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !service) return;
  try {
    const response = await fetch(`${base}/rest/v1/rpc/refund_import_usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: service,
        Authorization: `Bearer ${service}`,
      },
      body: JSON.stringify({ p_user_id: userId }),
    });
    if (!response.ok) {
      console.warn("refund rpc failed", response.status, (await response.text()).slice(0, 200));
    }
  } catch (problem) {
    console.warn("refund rpc threw", String(problem).slice(0, 200));
  }
}
