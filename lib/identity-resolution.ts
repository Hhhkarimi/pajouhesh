import type { Identity, ResearcherResult } from './model';
import { normalizeId, validOrcid } from './identifiers';
import { fetchJson, mapLimit } from './http';

interface Value { value?: string }
export interface OrcidPerson {
  name?: { 'credit-name'?: Value; 'given-names'?: Value; 'family-name'?: Value };
  'external-identifiers'?: { 'external-identifier'?: { 'external-id-type'?: string; 'external-id-value'?: string; 'external-id-url'?: Value }[] };
  'researcher-urls'?: { 'researcher-url'?: { url?: Value }[] };
}
export interface ResolvedIdentity { orcid: string; resolution: ResearcherResult['resolution']; name?: string; aliases?:string[] }
export function personNames(person:OrcidPerson):string[]{return [...new Set([person.name?.['credit-name']?.value,[person.name?.['given-names']?.value,person.name?.['family-name']?.value].filter(Boolean).join(' ')].filter((n):n is string=>!!n))];}
export interface ResolutionReport { match: ResolvedIdentity | null; warnings: string[]; ambiguous: boolean; unavailable: boolean }
const lookupOptions = { timeoutMs: 4000, retries: 0 };
export const orcidHeaders = (): Record<string, string> => process.env.ORCID_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.ORCID_ACCESS_TOKEN}` } : {};

function matchingProfileUrl(identity: Identity, value: string): boolean {
  // normalizeId accepts only provider domains and returns an ID for recognized URLs.
  if (!/^https?:\/\//i.test(value)) return false;
  return normalizeId(identity.provider, value) === identity.id;
}
export function personMatchesIdentity(person: OrcidPerson, identity: Identity): boolean {
  if (identity.provider === 'orcid') return false;
  const aliases = { scopus: ['scopus','scopusauthorid'], wos: ['researcherid','webofscienceresearcherid','wosresearcherid'], scholar: ['googlescholar','googlescholarid','googlescholaruserid','scholarid'] }[identity.provider];
  const external = person['external-identifiers']?.['external-identifier'] || [];
  if (external.some(entry => {
    const type = (entry['external-id-type'] || '').toLowerCase().replace(/[^a-z]/g,'');
    return (aliases.includes(type) && normalizeId(identity.provider, entry['external-id-value'] || '') === identity.id)
      || matchingProfileUrl(identity, entry['external-id-url']?.value || '');
  })) return true;
  return (person['researcher-urls']?.['researcher-url'] || []).some(entry => matchingProfileUrl(identity, entry.url?.value || ''));
}

export async function resolveIdentityWithReport(identity: Identity): Promise<ResolutionReport> {
  const empty: ResolutionReport = { match: null, warnings: [], ambiguous: false, unavailable: false };
  if (identity.provider === 'orcid') return { ...empty, match: { orcid: identity.id, resolution: 'direct' } };
  if (identity.orcid) return { ...empty, match: { orcid: identity.orcid, resolution: 'user' } };
  const property = { scopus: 'P1153', wos: 'P1053', scholar: 'P1960' }[identity.provider];
  const wikiQuery = `SELECT DISTINCT ?orcid WHERE { ?person wdt:${property} ${JSON.stringify(identity.id)}; wdt:P496 ?orcid. } LIMIT 3`;
  // Search is only discovery. Each ORCID candidate must prove the exact provider ID in /person.
  const registryQuery = `${identity.provider === 'scholar' ? 'text' : 'external-id-reference'}:${JSON.stringify(identity.id)}`;
  const [registry, wiki] = await Promise.allSettled([
    fetchJson<{ 'num-found'?: number; result?: { 'orcid-identifier'?: { path?: string } }[] }>(`https://pub.orcid.org/v3.0/search/?q=${encodeURIComponent(registryQuery)}&rows=5`, 'ORCID Search', orcidHeaders(), lookupOptions),
    fetchJson<{ results?: { bindings?: { orcid?: Value }[] } }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(wikiQuery)}`, 'Wikidata', {}, lookupOptions)
  ]);
  const warnings: string[] = []; const candidates = new Map<string, ResolvedIdentity>(); let overflow = false; let successfulSources = 0;
  if (wiki.status === 'fulfilled' && Array.isArray(wiki.value.results?.bindings)) {
    successfulSources++;
    for (const binding of wiki.value.results.bindings) {
      const orcid = binding.orcid?.value || ''; if (validOrcid(orcid)) candidates.set(orcid, { orcid, resolution: 'wikidata' });
    }
  } else warnings.push(wiki.status === 'rejected' && wiki.reason instanceof Error ? wiki.reason.message : 'ساختار پاسخ Wikidata معتبر نبود.');
  if (registry.status === 'fulfilled' && Array.isArray(registry.value.result)) {
    successfulSources++; overflow = (registry.value['num-found'] || 0) > 5;
    const ids = [...new Set(registry.value.result.map(r=>r['orcid-identifier']?.path || '').filter(validOrcid))];
    const verified = await mapLimit(ids, 3, async orcid => {
      try {
        const person = await fetchJson<OrcidPerson>(`https://pub.orcid.org/v3.0/${orcid}/person`, 'ORCID', orcidHeaders(), lookupOptions);
        if (!personMatchesIdentity(person, identity)) return null;
        const aliases=personNames(person);
        return { orcid, resolution: 'orcid-search' as const, name:aliases[0]||'',aliases };
      } catch (error) { warnings.push(error instanceof Error ? error.message : 'تأیید شناسه در پروفایل ORCID انجام نشد.'); return null; }
    });
    for (const match of verified) if (match) candidates.set(match.orcid, match);
  } else warnings.push(registry.status === 'rejected' && registry.reason instanceof Error ? registry.reason.message : 'ساختار پاسخ جست‌وجوی ORCID معتبر نبود.');
  const ambiguous = overflow || candidates.size > 1;
  return { match: !ambiguous && candidates.size === 1 ? [...candidates.values()][0] : null, warnings: [...new Set(warnings)], ambiguous, unavailable: successfulSources === 0 };
}
export async function resolveIdentity(identity: Identity): Promise<ResolvedIdentity | null> { return (await resolveIdentityWithReport(identity)).match; }
