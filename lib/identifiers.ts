import { z } from 'zod';
import type { Identity, Provider } from './model';

export function validOrcid(value: string): boolean {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(value)) return false;
  const digits = value.replaceAll('-', '');
  let total = 0;
  for (const ch of digits.slice(0, 15)) total = (total + Number(ch)) * 2;
  const check = (12 - (total % 11)) % 11;
  return digits[15] === (check === 10 ? 'X' : String(check));
}
export function normalizeId(provider: Provider, raw: string): string {
  let value = raw.trim().replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  try {
    const u = new URL(value);
    if (provider === 'scholar' && /(^|\.)scholar\.google\./.test(u.hostname)) value = u.searchParams.get('user') || '';
    else if (provider === 'scopus' && /(^|\.)scopus\.com$/.test(u.hostname)) value = u.searchParams.get('authorId') || '';
    else if (provider === 'orcid' && /(^|\.)orcid\.org$/.test(u.hostname)) value = u.pathname.split('/').filter(Boolean).pop() || '';
    else if (provider === 'wos' && /(^|\.)webofscience\.com$/.test(u.hostname)) value = u.pathname.match(/(?:author\/record|researcher)\/([^/]+)/)?.[1] || '';
  } catch { /* Plain identifiers are expected. */ }
  if (provider === 'orcid' || provider === 'wos') value = value.toUpperCase();
  return value;
}
export function idError(provider: Provider, value: string): string | null {
  if (provider === 'orcid' && !validOrcid(value)) return 'ساختار یا رقم کنترل ORCID درست نیست؛ نمونه: 0000-0002-1825-0097';
  if (provider === 'scopus' && !/^\d{8,14}$/.test(value)) return 'Scopus Author ID باید ۸ تا ۱۴ رقم باشد؛ در اکسل از قالب Text استفاده کنید.';
  if (provider === 'wos' && !/^[A-Z]{1,5}-\d{4,9}-\d{4}$/.test(value)) return 'ResearcherID باید مانند A-1234-2010 باشد.';
  if (provider === 'scholar' && !/^[A-Za-z0-9_-]{12}$/.test(value)) return 'شناسه Google Scholar باید ۱۲ کاراکتر باشد؛ پارامتر user در نشانی پروفایل.';
  return null;
}
export const identitySchema = z.object({
  provider: z.enum(['orcid','scopus','wos','scholar']), id: z.string().max(200),
  name: z.string().max(200).default(''), orcid: z.string().max(200).optional()
}).transform(v => ({ ...v, id: normalizeId(v.provider, v.id), orcid: v.orcid ? normalizeId('orcid', v.orcid) : undefined }))
  .superRefine((v, ctx) => {
    const error = idError(v.provider, v.id);
    if (error) ctx.addIssue({ code: 'custom', message: error, path: ['id'] });
    if (v.orcid && !validOrcid(v.orcid)) ctx.addIssue({ code: 'custom', message: 'ORCID متناظر معتبر نیست.', path: ['orcid'] });
  });
export const collectSchema = z.object({ identity: identitySchema, offset: z.number().int().min(0).max(100000).default(0), resolvedOrcid: z.string().refine(validOrcid).optional(), resolution: z.enum(['direct','user','wikidata']).optional(), snapshot: z.string().max(100).optional(), enrich: z.boolean().default(true) });
export function parseManual(provider: Provider, text: string, name = '', orcid = ''): { identities: Identity[]; errors: string[] } {
  const identities: Identity[] = []; const errors: string[] = [];
  const parts = text.split(/[\s,;،]+/).filter(Boolean);
  if (parts.length > 500) return { identities, errors: ['در هر بار ورود حداکثر ۵۰۰ شناسه مجاز است.'] };
  for (const part of parts) {
    const parsed = identitySchema.safeParse({ provider, id: part, name, orcid: provider === 'orcid' ? undefined : (orcid || undefined) });
    if (parsed.success) identities.push(parsed.data);
    else errors.push(`${part}: ${parsed.error.issues[0].message}`);
  }
  if (!parts.length) errors.push('حداقل یک شناسه یا نشانی پروفایل وارد کنید.');
  return { identities: [...new Map(identities.map(i => [`${i.provider}:${i.id}`, i])).values()], errors };
}
