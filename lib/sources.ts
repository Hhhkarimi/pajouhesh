import { createHash } from 'node:crypto';
import type { Identity, Publication, CollectResponse, ResearcherResult } from './model';
import { blankPublication, normalizeDoi, safeUrl, identityKey } from './model';
import { validOrcid } from './identifiers';
import { fetchJson, mapLimit, SourceError } from './http';

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
const orcidHeaders = (): Record<string, string> => process.env.ORCID_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.ORCID_ACCESS_TOKEN}` } : {};

export async function resolveIdentity(identity: Identity): Promise<{ orcid: string; resolution: ResearcherResult['resolution'] } | null> {
  if (identity.provider === 'orcid') return { orcid: identity.id, resolution: 'direct' };
  if (identity.orcid) return { orcid: identity.orcid, resolution: 'user' };
  const property = { scopus: 'P1153', wos: 'P1053', scholar: 'P1960' }[identity.provider];
  // Identifier validation runs before this function. Only validated literals enter SPARQL.
  const query = `SELECT DISTINCT ?orcid WHERE { ?person wdt:${property} ${JSON.stringify(identity.id)}; wdt:P496 ?orcid. } LIMIT 3`;
  const data = await fetchJson<{ results?: { bindings?: { orcid?: Value }[] } }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, 'Wikidata');
  const candidates = [...new Set((data.results?.bindings || []).map(b => b.orcid?.value || '').filter(validOrcid))];
  // Ambiguous public mappings are never silently selected.
  return candidates.length === 1 ? { orcid: candidates[0], resolution: 'wikidata' } : null;
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
export async function collectPage(input: { identity: Identity; offset: number; resolvedOrcid?: string; resolution?: ResearcherResult['resolution']; snapshot?: string; enrich: boolean }): Promise<CollectResponse> {
  const { identity, offset, enrich } = input;
  const resolved = offset > 0 && input.resolvedOrcid ? { orcid: input.resolvedOrcid, resolution: input.resolution } : await resolveIdentity(identity);
  const researcher: ResearcherResult = { identity, name: identity.name, total: 0, status: 'unresolved', message: '' };
  if (!resolved) {
    researcher.message = 'پیوند عمومی یکتایی به ORCID در Wikidata پیدا نشد. ORCID متناظر را به همین شناسه اضافه کنید یا فایل مقالات این پایگاه را وارد کنید. این وضعیت به معنی نداشتن مقاله نیست.';
    return { researcher, publications: [], nextOffset: null, warnings: [], snapshot: '' };
  }
  researcher.resolvedOrcid = resolved.orcid; researcher.resolution = resolved.resolution;
  const base = `https://pub.orcid.org/v3.0/${resolved.orcid}`;
  const summary = await fetchJson<OrcidSummary>(`${base}/works`, 'ORCID', orcidHeaders());
  if (!Array.isArray(summary.group)) throw new SourceError('ORCID',502,'پاسخ فهرست آثار ORCID ساختار مورد انتظار را ندارد.');
  const groups = summary.group.map(g => [...(g['work-summary'] || [])].sort((a,b) => Number(b['display-index'] || 0) - Number(a['display-index'] || 0))[0]).filter((w): w is OrcidWork => !!w).sort((a,b)=>a['put-code']-b['put-code']);
  const snapshot = createHash('sha256').update(`${summary['last-modified-date']?.value}:${groups.map(w=>w['put-code']).join(',')}`).digest('hex').slice(0,24);
  if (input.snapshot && snapshot !== input.snapshot) throw new SourceError('ORCID',409,'فهرست آثار حین دریافت تغییر کرد؛ دریافت این پژوهشگر را از ابتدا تکرار کنید.');
  researcher.total = groups.length;
  const warnings: string[] = [];
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
