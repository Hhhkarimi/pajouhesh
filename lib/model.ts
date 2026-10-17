export const providers = ['orcid', 'scopus', 'wos', 'scholar'] as const;
export type Provider = typeof providers[number];
export const providerNames: Record<Provider, string> = { orcid: 'ORCID', scopus: 'Scopus', wos: 'Web of Science', scholar: 'Google Scholar' };
export interface Identity { provider: Provider; id: string; name: string; orcid?: string }
export interface Publication {
  key: string; title: string; authors: string[]; journal: string; year: string;
  volume: string; issue: string; pages: string; articleNumber: string; doi: string;
  issn: string; publisher: string; type: string; url: string; date: string;
  sources: string[]; queriedIds: string[]; orcids: string[]; notes: string[];
  retrievedAt: string; originalPublication: string;
}
export interface ResearcherResult {
  identity: Identity; resolvedOrcid?: string; resolution?: 'direct' | 'user' | 'wikidata';
  name: string; total: number; status: 'complete' | 'partial' | 'unresolved' | 'error'; message: string;
}
export interface CollectResponse {
  researcher: ResearcherResult; publications: Publication[]; nextOffset: number | null;
  warnings: string[]; snapshot: string;
}
export function blankPublication(): Publication {
  return { key: '', title: '', authors: [], journal: '', year: '', volume: '', issue: '', pages: '', articleNumber: '', doi: '', issn: '', publisher: '', type: '', url: '', date: '', sources: [], queriedIds: [], orcids: [], notes: [], retrievedAt: new Date().toISOString(), originalPublication: '' };
}
export function normalizeDoi(value: string): string {
  return value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').toLowerCase();
}
export function safeUrl(value: string): string {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export function mergePublications(records: Publication[]): Publication[] {
  const merged = new Map<string, Publication>();
  for (const input of records) {
    const p = { ...input, doi: normalizeDoi(input.doi) };
    // Never guess that two DOI-less articles with the same title are the same work.
    const key = p.doi ? `doi:${p.doi}` : p.key;
    const old = merged.get(key);
    if (!old) { merged.set(key, { ...p, key }); continue; }
    const result = { ...old };
    for (const field of ['title','journal','year','volume','issue','pages','articleNumber','issn','publisher','type','url','date','originalPublication'] as const) {
      if (!result[field]) result[field] = p[field];
    }
    if (p.authors.length > old.authors.length) result.authors = p.authors;
    for (const field of ['sources','queriedIds','orcids','notes'] as const) result[field] = [...new Set([...old[field], ...p[field]])];
    merged.set(key, result);
  }
  return [...merged.values()];
}
export const identityKey = (i: Identity): string => `${i.provider}:${i.id}`;
