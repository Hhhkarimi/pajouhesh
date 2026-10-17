export class SourceError extends Error {
  constructor(public source: string, public status: number, message: string) { super(message); }
}
interface FetchOptions { timeoutMs?: number; retries?: number }
async function fetchResponse(url: string, source: string, headers: Record<string, string>, options: FetchOptions): Promise<Response> {
  const attempts = 1 + (options.retries ?? 1);
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try { response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Pajouhesh/1.0 (public scholarly metadata)', ...headers }, signal: AbortSignal.timeout(options.timeoutMs ?? 6000), redirect: 'error', cache: 'no-store' }); }
    catch { throw new SourceError(source, 0, `اتصال به ${source} برقرار نشد یا مهلت پاسخ تمام شد؛ دوباره تلاش کنید.`); }
    if ((response.status === 429 || response.status === 503) && attempt + 1 < attempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); continue;
    }
    if (!response.ok) {
      const message = response.status === 404 ? `رکوردی در ${source} پیدا نشد.` : response.status === 429 ? `سهمیه ${source} موقتاً پر شده؛ کمی بعد دوباره تلاش کنید.` : [401, 403].includes(response.status) ? `دسترسی ${source} محدود شده؛ تنظیمات یا سهمیه منبع را بررسی کنید.` : `${source} با خطای ${response.status} پاسخ داد.`;
      throw new SourceError(source, response.status, message);
    }
    return response;
  }
  throw new SourceError(source, 503, `منبع ${source} موقتاً در دسترس نیست.`);
}
export async function fetchJson<T>(url: string, source: string, headers: Record<string, string> = {}, options: FetchOptions = {}): Promise<T> {
  const response = await fetchResponse(url, source, headers, options);
  try { return await response.json() as T; } catch { throw new SourceError(source, 502, `پاسخ ${source} قابل خواندن نبود.`); }
}
export async function fetchHtml(url: string, source: string): Promise<string> {
  const response = await fetchResponse(url, source, { Accept: 'text/html' }, { timeoutMs: 6000, retries: 0 });
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length') || 0) > limit) throw new SourceError(source, 502, 'صفحه عمومی بیش از حد بزرگ است.');
  const reader = response.body?.getReader(); if (!reader) throw new SourceError(source, 502, 'پاسخ صفحه عمومی خالی بود.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new SourceError(source, 502, 'صفحه عمومی بیش از حد بزرگ است.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const prefix = new TextDecoder().decode(bytes.slice(0, 2048));
  const charset = response.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1] || prefix.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}
export async function mapLimit<T, R>(values: T[], concurrency: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) { const i = index++; results[i] = await fn(values[i]); }
  }));
  return results;
}
