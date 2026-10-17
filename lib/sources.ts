import { createHash } from 'node:crypto';
import type { Identity, Publication, CollectResponse, ResearcherResult } from './model';
import { blankPublication, normalizeDoi, safeUrl, identityKey } from './model';
import { fetchJson, mapLimit, SourceError } from './http';
import { orcidHeaders, resolveIdentityWithReport } from './identity-resolution';
import { collectScholarProfile } from './scholar';
export { resolveIdentity } from './identity-resolution';

interface Value { value?: string }
interface ExternalId { 'external-id-type': string; 'external-id-value': string; 'external-id-relationship'?: string }
export interface OrcidWork {
  'put-code': number; title?: { title?: Value }; 'journal-title'?: Value;
  'publication-date'?: { year?: Value; month?: Value; day?: Value }; type?: string;
  'external-ids'?: { 'external-id'?: ExternalId[] }; url?: Value; 'display-index'?: string;
  contributors?: { contributor?: { 'credit-name'?: Value }[] };
}
interface OrcidSummary { group?: { 'work-summary'?: OrcidWork[] }[]; 'last-modified-date'?: { value?: number } }
export interface CrossrefWork {
  title?: string[]; author?: { given?: string; family?: string; name?: string }[];
  'container-title'?: string[]; volume?: string; issue?: string; page?: string;
  'article-number'?: string; ISSN?: string[]; publisher?: string; type?: string;
  published?: { 'date-parts'?: number[][] }; DOI?: string;
}
export function fromOrcid(work: OrcidWork, identity: Identity, orcid: string): Publication {
  const p = blankPublication(); const date = work['publication-date'];
  p.key = `orcid:${orcid}:${work['put-code']}`; p.title = work.title?.title?.value || 'عنوان در منبع ثبت نشده';
  p.journal = work['journal-title']?.value || ''; p.year = date?.year?.value || '';
  p.date = [date?.year?.value, date?.month?.value?.padStart(2,'0'), date?.day?.value?.padStart(2,'0')].filter(Boolean).join('-');
  p.type = work.type || ''; p.authors = (work.contributors?.contributor || []).map(c => c['credit-name']?.value || '').filter(Boolean);
  const ids = work['external-ids']?.['external-id'] || [];
  p.doi = normalizeDoi(ids.find(i => i['external-id-type'].toLowerCase() === 'doi' && (!i['external-id-relationship'] || i['external-id-relationship'] === 'self'))?.['external-id-value'] || '');
  p.issn = ids.filter(i => i['external-id-type'].toLowerCase() === 'issn').map(i => i['external-id-value']).join('; ');
  p.url = p.doi ? safeUrl(`https://doi.org/${p.doi}`) : safeUrl(work.url?.value || '');
  p.sources = ['ORCID']; p.queriedIds = [identityKey(identity)]; p.orcids = [orcid];
  return p;
}
export function enrichCrossref(p: Publication, work: CrossrefWork): Publication {
  if (normalizeDoi(work.DOI || '') !== p.doi) return { ...p, notes: [...p.notes, 'DOI پاسخ Crossref با درخواست یکسان نبود.'] };
  const authors = (work.author || []).map(a => a.name || [a.given,a.family].filter(Boolean).join(' ')).filter(Boolean);
  return { ...p, authors: authors.length ? authors : p.authors, journal: work['container-title']?.[0] || p.journal,
    volume: work.volume || p.volume, issue: work.issue || p.issue, pages: work.page || p.pages,
    articleNumber: work['article-number'] || p.articleNumber, issn: work.ISSN?.join('; ') || p.issn,
    publisher: work.publisher || p.publisher, year: p.year || String(work.published?.['date-parts']?.[0]?.[0] || ''),
    sources: [...new Set([...p.sources, 'Crossref'])] };
}
export async function collectPage(input: { identity: Identity; offset: number; resolvedOrcid?: string; resolvedName?: string; resolution?: ResearcherResult['resolution']; snapshot?: string; enrich: boolean }): Promise<CollectResponse> {
  const { identity, offset, enrich } = input;
  const report = offset > 0 && input.resolvedOrcid
    ? { match: { orcid: input.resolvedOrcid, resolution: input.resolution, name: input.resolvedName }, warnings: [], ambiguous: false, unavailable: false }
    : await resolveIdentityWithReport(identity);
  const resolved = report.match;
  const researcher: ResearcherResult = { identity, name: identity.name, total: 0, status: 'unresolved', message: '' };
  if (!resolved) {
    if (identity.provider === 'scholar') {
      try {
        const result = await collectScholarProfile(identity);
        result.warnings = [...report.warnings, ...result.warnings];
        if (result.warnings.length) result.researcher.status = 'partial';
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'صفحه عمومی Scholar دریافت نشد.';
        researcher.status = 'error'; researcher.message = `${message} می‌توانید ORCID متناظر را تعیین کنید یا فایل CSV پروفایل را وارد کنید.`;
        return {researcher,publications:[],nextOffset:null,warnings:[...report.warnings,message],snapshot:''};
      }
    }
    researcher.status = report.unavailable ? 'error' : 'unresolved';
    researcher.message = report.ambiguous ? 'چند پیوند ORCID ناسازگار پیدا شد؛ برای جلوگیری از انتساب اشتباه، ORCID متناظر را خودتان تعیین کنید.'
      : 'پیوند تأییدشده به ORCID در جست‌وجوی ORCID و Wikidata پیدا نشد. از «تعیین ORCID متناظر» کنار همین شناسه استفاده کنید یا فایل مقالات را وارد کنید. این نتیجه به معنی نداشتن مقاله نیست.';
    return { researcher, publications: [], nextOffset: null, warnings: report.warnings, snapshot: '' };
  }
  researcher.name = identity.name || resolved.name || '';
  researcher.resolvedOrcid = resolved.orcid; researcher.resolution = resolved.resolution;
  const base = `https://pub.orcid.org/v3.0/${resolved.orcid}`;
  const summary = await fetchJson<OrcidSummary>(`${base}/works`, 'ORCID', orcidHeaders());
  if (!Array.isArray(summary.group)) throw new SourceError('ORCID',502,'پاسخ فهرست آثار ORCID ساختار مورد انتظار را ندارد.');
  const groups = summary.group.map(g => [...(g['work-summary'] || [])].sort((a,b) => Number(b['display-index'] || 0) - Number(a['display-index'] || 0))[0]).filter((w): w is OrcidWork => !!w).sort((a,b)=>a['put-code']-b['put-code']);
  const snapshot = createHash('sha256').update(`${summary['last-modified-date']?.value}:${groups.map(w=>w['put-code']).join(',')}`).digest('hex').slice(0,24);
  if (input.snapshot && snapshot !== input.snapshot) throw new SourceError('ORCID',409,'فهرست آثار حین دریافت تغییر کرد؛ دریافت این پژوهشگر را از ابتدا تکرار کنید.');
  researcher.total = groups.length;
  const warnings: string[] = [...report.warnings];
  const current = groups.slice(offset, offset + 4);
  // Four bounded requests at a time, with a maximum of four works per invocation.
  const publications = await mapLimit(current, 4, async summaryWork => {
    let work = summaryWork; const notes: string[] = [];
    try { work = await fetchJson<OrcidWork>(`${base}/work/${summaryWork['put-code']}`, 'ORCID', orcidHeaders()); }
    catch (error) { const note = error instanceof Error ? error.message : 'جزئیات اثر دریافت نشد.'; notes.push(note); warnings.push(note); }
    let p = fromOrcid(work, identity, resolved.orcid); p.notes.push(...notes);
    if (enrich && p.doi) {
      try {
        const query = process.env.CROSSREF_MAILTO ? `?mailto=${encodeURIComponent(process.env.CROSSREF_MAILTO)}` : '';
        const data = await fetchJson<{ message: CrossrefWork }>(`https://api.crossref.org/works/${encodeURIComponent(p.doi)}${query}`, 'Crossref');
        p = enrichCrossref(p, data.message);
      } catch (error) {
        const note = error instanceof Error ? error.message : 'تکمیل Crossref انجام نشد.';
        p.notes.push(note); warnings.push(note);
      }
    }
    if (!p.authors.length) p.notes.push('نام نویسندگان در پاسخ‌های در دسترس ثبت نشده است.');
    return p;
  });
  const nextOffset = offset + current.length < groups.length ? offset + current.length : null;
  researcher.status = nextOffset !== null || warnings.length ? 'partial' : 'complete';
  researcher.message = groups.length ? 'فهرست آثار عمومی ORCID؛ پوشش آن وابسته به تکمیل پروفایل پژوهشگر است.' : 'این پروفایل اثر عمومی ندارد؛ ممکن است آثار خصوصی باشند یا هنوز ثبت نشده باشند.';
  return { researcher, publications, nextOffset, warnings: [...new Set(warnings)], snapshot };
}
