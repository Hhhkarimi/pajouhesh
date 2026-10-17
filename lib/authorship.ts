import type { AuthorDetail, Publication, ResearcherReference, ResearcherResult } from './model';

export function normalizeName(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
function nameVariants(value: string): string[] {
  const parts=value.split(',').map(s=>s.trim());
  return [...new Set([normalizeName(value),...(parts.length===2?[normalizeName(`${parts[1]} ${parts[0]}`)]:[])].filter(Boolean))];
}
function fullName(value:string):boolean { return normalizeName(value).split(' ').filter(word=>word.length>1).length>=2; }
function referenceNames(ref: ResearcherReference): string[] { return [...new Set([ref.name,...ref.aliases].flatMap(nameVariants))]; }

export function mergeResearcherReferences(values: ResearcherReference[]): ResearcherReference[] {
  const result:ResearcherReference[]=[];
  // Known ORCIDs are established first so an unlinked name never bridges two different ORCIDs.
  for(const value of [...values].sort((a,b)=>Number(!!b.orcid)-Number(!!a.orcid))){
    const ref={...value,aliases:[...new Set(value.aliases||[])],queriedIds:[...new Set(value.queriedIds||[])]};
    const names=referenceNames(ref).filter(n=>fullName(n));
    const matches=result.filter(old=>{
      if(ref.orcid&&old.orcid)return ref.orcid===old.orcid;
      if(old.key===ref.key)return true;
      return referenceNames(old).some(n=>names.includes(n));
    });
    if(matches.length!==1){result.push(ref);continue;}
    const old=matches[0];old.orcid=old.orcid||ref.orcid;old.key=old.orcid?`orcid:${old.orcid}`:old.key;
    if(!old.name||old.name===old.queriedIds[0])old.name=ref.name;
    old.aliases=[...new Set([...old.aliases,...ref.aliases,old.name,ref.name].filter(Boolean))];
    old.queriedIds=[...new Set([...old.queriedIds,...ref.queriedIds])];
  }
  return result;
}
export function withResearcher(p:Publication,result:ResearcherResult):Publication {
  const id=`${result.identity.provider}:${result.identity.id}`;
  const name=result.identity.name||result.name||'';
  const aliases=[...new Set([name,result.name,...(result.aliases||[])].filter(Boolean))];
  const orcid=result.resolvedOrcid||result.identity.orcid||(result.identity.provider==='orcid'?result.identity.id:'');
  const ref:ResearcherReference={key:orcid?`orcid:${orcid}`:aliases.length?`name:${normalizeName(aliases[0])}`:id,name:name||id,orcid,aliases,queriedIds:[id]};
  return {...p,researchers:mergeResearcherReferences([...(p.researchers||[]),ref])};
}
export function restoreResearcherLinks(p:Publication,results:ResearcherResult[]):Publication {
  return results.filter(r=>p.queriedIds.includes(`${r.identity.provider}:${r.identity.id}`)||!!r.resolvedOrcid&&p.orcids.includes(r.resolvedOrcid))
    .reduce((row,result)=>withResearcher(row,result),p);
}
export function authorDetailsFor(p:Publication):AuthorDetail[]{
  if(p.authorDetails?.length)return p.authorDetails;
  // Backward compatibility for saved records. ORCID contributors without sequence remain unordered.
  const ordered=p.sources.some(source=>source==='Crossref'||source==='Google Scholar'||source.startsWith('فایل:'));
  return p.authors.map((name,index)=>({name,orcid:'',position:ordered?(index===0?'first':'additional'):'unknown',source:p.sources.join(' + ')}));
}
export interface AuthorshipAssessment { researcher:ResearcherReference; firstAuthor:boolean|null; reason:string }
function positionVerdict(details:AuthorDetail[]):boolean|null{
  const first=details.some(d=>d.position==='first');const additional=details.some(d=>d.position==='additional');
  return first&&additional?null:first?true:additional?false:null;
}
export function assessFirstAuthor(p:Publication,ref:ResearcherReference):AuthorshipAssessment {
  const details=authorDetailsFor(p);
  const byOrcid=ref.orcid?details.filter(d=>d.orcid===ref.orcid&&d.position!=='unknown'):[];
  if(byOrcid.length){const value=positionVerdict(byOrcid);return {researcher:ref,firstAuthor:value,reason:value===null?'ترتیب نویسندگان در منابع ناسازگار است.':'تطابق ORCID نویسنده و ترتیب ثبت‌شده در منبع.'};}
  const names=[ref.name,...ref.aliases].filter(fullName).flatMap(nameVariants);
  const byName=details.filter(d=>fullName(d.name)&&nameVariants(d.name).some(n=>names.includes(n))&&(!ref.orcid||!d.orcid||d.orcid===ref.orcid));
  const distinctOrcids=new Set(byName.map(d=>d.orcid).filter(Boolean));
  if(distinctOrcids.size>1)return {researcher:ref,firstAuthor:null,reason:'چند نویسنده هم‌نام با ORCID متفاوت وجود دارد.'};
  if(byName.some(d=>d.position!=='unknown')){const value=positionVerdict(byName);return {researcher:ref,firstAuthor:value,reason:value===null?'ترتیب نویسندگان در منابع ناسازگار است.':'تطابق کامل نام پژوهشگر با ترتیب نویسندگان منبع.'};}
  return {researcher:ref,firstAuthor:null,reason:'نام کامل، تطابق هویت یا ترتیب نویسندگان برای تشخیص کافی نیست.'};
}
export function publicationResearchers(p:Publication):AuthorshipAssessment[]{ return (p.researchers||[]).map(ref=>assessFirstAuthor(p,ref)); }
export const firstAuthorLabel=(value:boolean|null):string=>value===true?'☑ بله':value===false?'☐ خیر':'— نامشخص';
