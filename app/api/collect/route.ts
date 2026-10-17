import { NextResponse } from 'next/server';
import { collectSchema } from '@/lib/identifiers';
import { collectPage } from '@/lib/sources';
import { SourceError } from '@/lib/http';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request): Promise<NextResponse> {
  if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ error: 'بدنه باید JSON باشد.' }, { status: 415 });
  const origin = request.headers.get('origin');
  // A Next standalone/custom server can use an internal hostname in request.url.
  // Compare the browser origin with the public Host header, falling back to URL.
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* Invalid origins fail closed. */ }
    if (originHost !== (request.headers.get('host') || new URL(request.url).host)) return NextResponse.json({ error: 'مبدأ درخواست مجاز نیست.' }, { status: 403 });
  }
  if (Number(request.headers.get('content-length') || 0) > 8192) return NextResponse.json({ error: 'درخواست بیش از حد بزرگ است.' }, { status: 413 });
  let body: unknown;
  try { const text = await request.text(); if (text.length > 8192) return NextResponse.json({ error: 'درخواست بیش از حد بزرگ است.' }, { status: 413 }); body = JSON.parse(text); }
  catch { return NextResponse.json({ error: 'ساختار JSON معتبر نیست.' }, { status: 400 }); }
  const parsed = collectSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try { return NextResponse.json(await collectPage(parsed.data), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    const message = error instanceof SourceError ? error.message : 'دریافت اطلاعات انجام نشد؛ دوباره تلاش کنید.';
    return NextResponse.json({ error: message }, { status: error instanceof SourceError && error.status === 409 ? 409 : 502 });
  }
}
