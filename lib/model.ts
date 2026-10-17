import { authorDetailsFor, mergeResearcherReferences, normalizeName } from './authorship';
import { normalizedTitle, usableTitle } from './title-matching';
export const providers = ['orcid', 'scopus', 'wos', 'scholar'] as const;
export type Provider = typeof providers[number];
export const providerNames: Record<Provider, string> = { orcid: 'ORCID', scopus: 'Scopus', wos: 'Web of Science', scholar: 'Google Scholar' };
export const resolutionMethods = ['direct', 'user', 'wikidata', 'orcid-search', 'scholar-public'] as const;
export const resolutionNames: Record<typeof resolutionMethods[number], string> = { direct: 'ورودی مستقیم ORCID', user: 'نگاشت تعیین‌شده توسط شما', wikidata: 'پیوند عمومی Wikidata', 'orcid-search': 'شناسه تأییدشده در پروفایل ORCID', 'scholar-public': 'صفحه عمومی Google Scholar' };
export interface Identity { provider: Provider; id: string; name: string; orcid?: string }
export interface AuthorDetail { name:string; orcid:string; position:'first'|'additional'|'unknown'; source:string }
export interface ResearcherReference { key:string; name:string; orcid:string; aliases:string[]; queriedIds:string[] }
export interface Publication {
  key: string; title: string; authors: string[]; journal: string; year: string;
  volume: string; issue: string; pages: string; articleNumber: string; doi: string;
  issn: string; publisher: string; type: string; url: string; date: string;
  sources: string[]; queriedIds: string[]; orcids: string[]; notes: string[];
  retrievedAt: string; originalPublication: string;
  authorDetails:AuthorDetail[]; researchers:ResearcherReference[]; primaryScore?:number; recordKey?:string;
}
export interface ResearcherResult {
  identity: Identity; resolvedOrcid?: string; resolution?: typeof resolutionMethods[number];
  name: string; total: number; status: 'complete' | 'partial' | 'unresolved' | 'error'; message: string;
  aliases?:string[];
}
export interface CollectResponse {
  researcher: ResearcherResult; publications: Publication[]; nextOffset: number | null;
  warnings: string[]; snapshot: string;
}
export function blankPublication(): Publication {
  return { key: '', title: '', authors: [], journal: '', year: '', volume: '', issue: '', pages: '', articleNumber: '', doi: '', issn: '', publisher: '', type: '', url: '', date: '', sources: [], queriedIds: [], orcids: [], notes: [], retrievedAt: new Date().toISOString(), originalPublication: '',authorDetails:[],researchers:[] };
}
export function normalizeDoi(value: string): string {
  return value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').toLowerCase();
}
export function safeUrl(value: string): string {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
const metadataFields=['title','journal','year','volume','issue','pages','articleNumber','doi','issn','publisher','type','url','date','originalPublication'] as const;
export function publicationCompleteness(p:Publication):number {
  const fields=metadataFields.filter(field=>p[field]?.trim()&&(field!=='title'||usableTitle(p.title))).length+Number(p.authors.length>0);
  return fields*10000+Math.min(p.authors.filter(n=>n.trim()&&!/^[.…\s]+$/.test(n)).length,999)*10+Math.min((p.authorDetails||[]).filter(a=>a.orcid).length,9);
}
export function mergePublications(records:Publication[]):Publication[]{
  const owners=mergeResearcherReferences(records.flatMap(p=>p.researchers||[]));
  const scopes=new WeakMap<Publication,string>();
  const data=records.flatMap(p=>{
    const refs=(p.researchers||[]).map(ref=>{
      const exact=owners.find(owner=>ref.orcid?owner.orcid===ref.orcid:owner.key===ref.key||owner.queriedIds.some(id=>ref.queriedIds.includes(id)));
      if(exact)return exact;
      const names=[ref.name,...ref.aliases].map(normalizeName).filter(Boolean);
      const matches=owners.filter(owner=>[owner.name,...owner.aliases].some(name=>names.includes(normalizeName(name))));
      return matches.length===1?matches[0]:ref;
    });
    const unique=[...new Map(refs.map(ref=>[ref.key,ref])).values()];
    return (unique.length?unique:[undefined]).map(ref=>{
      const scope=ref?.key||(p.orcids.length===1?`orcid:${p.orcids[0]}`:p.queriedIds.length?`ids:${[...p.queriedIds].sort().join('|')}`:'unassigned');
      const row={...p,recordKey:p.recordKey||p.key,doi:normalizeDoi(p.doi),authorDetails:authorDetailsFor(p),researchers:ref?[ref]:[],queriedIds:ref?ref.queriedIds:p.queriedIds};
      scopes.set(row,scope);return row;
    });
  });
  const parents=data.map((_,i)=>i);const index=new Map<string,number>();
  const root=(i:number):number=>{let r=i;while(parents[r]!==r)r=parents[r];while(parents[i]!==i){const next=parents[i];parents[i]=r;i=next;}return r;};
  data.forEach((p,i)=>{
    const title=usableTitle(p.title)?normalizedTitle(p.title):'';
    // Short generic headings (e.g. Editorial) require matching publication context.
    const generic=['editorial','introduction','correction','erratum','preface','letter','review','مقدمه','سرمقاله','اصلاحیه'].includes(title);
    const titleKey=title&&(!generic?title:p.year&&p.journal?`${title}|${p.year}|${normalizedTitle(p.journal)}`:'');
    for(const match of [p.doi?`doi:${p.doi}`:'',p.recordKey?`source:${p.recordKey}`:'',titleKey?`title:${titleKey}`:''].filter(Boolean)){
      const key=JSON.stringify([scopes.get(p),match]);
      const previous=index.get(key);if(previous!==undefined)parents[root(i)]=root(previous);index.set(key,i);
    }
  });
  const groups=new Map<number,Publication[]>();data.forEach((p,i)=>{const key=root(i);const group=groups.get(key);if(group)group.push(p);else groups.set(key,[p]);});
  return [...groups.values()].map(group=>{
    const ranked=[...group].sort((a,b)=>(b.primaryScore??publicationCompleteness(b))-(a.primaryScore??publicationCompleteness(a))||b.retrievedAt.localeCompare(a.retrievedAt)||a.key.localeCompare(b.key));
    const winner=ranked[0];const result={...winner,key:JSON.stringify([scopes.get(winner),winner.recordKey]),primaryScore:winner.primaryScore??publicationCompleteness(winner)};
    for(const other of ranked.slice(1))for(const field of metadataFields)if(!result[field]?.trim()||(field==='title'&&!usableTitle(result.title)))result[field]=other[field];
    const mostAuthors=[...ranked].sort((a,b)=>b.authors.length-a.authors.length)[0];result.authors=[...mostAuthors.authors];
    for(const field of ['sources','queriedIds','orcids','notes'] as const)result[field]=[...new Set(group.flatMap(p=>p[field]))];
    result.authorDetails=[...new Map(ranked.flatMap(p=>p.authorDetails).map(a=>[JSON.stringify(a),a])).values()];
    result.researchers=mergeResearcherReferences(ranked.flatMap(p=>p.researchers));
    const dois=[...new Set(ranked.map(p=>p.doi).filter(Boolean))];
    if(dois.length>1)result.notes=[...new Set([...result.notes,`عنوان یکسان با DOIهای متفاوت ادغام شد؛ ردیف کامل‌تر مبنا قرار گرفت: ${dois.join('؛ ')}`])];
    return result;
  });
}
export const identityKey = (i: Identity): string => `${i.provider}:${i.id}`;
