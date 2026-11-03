/**
 * 模型通道预检。
 *
 * 为什么需要：2026-10-30 实测，通道挂掉时一次运行仍会走到 agent 创建、prep、
 * 若干次调用，最后以 502/超时失败，白烧 ¥0.3~1.05。
 * 预检只发一个 max_tokens=1 的文本请求，失败就整轮跳过，不碰手机。
 */

export type ModelHealth = { ok: boolean; ms: number; detail: string };

export async function checkModelHealth(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs = 20000,
): Promise<ModelHealth> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, ms, detail: `HTTP ${res.status} ${body.slice(0, 120)}` };
    }
    return { ok: true, ms, detail: `HTTP ${res.status}` };
  } catch (e: any) {
    return {
      ok: false,
      ms: Date.now() - t0,
      detail: `${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 120)}`,
    };
  }
}