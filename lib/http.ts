export class SourceError extends Error {
  constructor(public source: string, public status: number, message: string) { super(message); }
}
export async function fetchJson<T>(url: string, source: string, headers: Record<string, string> = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try { response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Pajouhesh/1.0 (public scholarly metadata)', ...headers }, signal: AbortSignal.timeout(6000), redirect: 'error', cache: 'no-store' }); }
    catch { throw new SourceError(source, 0, `اتصال به ${source} برقرار نشد یا مهلت پاسخ تمام شد؛ دوباره تلاش کنید.`); }
    if ((response.status === 429 || response.status === 503) && attempt === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000)); continue;
    }
    if (!response.ok) {
      const message = response.status === 404 ? `رکوردی در ${source} پیدا نشد.` : response.status === 429 ? `سهمیه ${source} موقتاً پر شده؛ کمی بعد دوباره تلاش کنید.` : [401, 403].includes(response.status) ? `دسترسی ${source} محدود شده؛ تنظیمات یا سهمیه منبع را بررسی کنید.` : `${source} با خطای ${response.status} پاسخ داد.`;
      throw new SourceError(source, response.status, message);
    }
    try { return await response.json() as T; } catch { throw new SourceError(source, 502, `پاسخ ${source} قابل خواندن نبود.`); }
  }
  throw new SourceError(source, 503, `منبع ${source} موقتاً در دسترس نیست.`);
}
export async function mapLimit<T, R>(values: T[], concurrency: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) { const i = index++; results[i] = await fn(values[i]); }
  }));
  return results;
}
