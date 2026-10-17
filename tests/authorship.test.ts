import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blankPublication, mergePublications, type Publication, type ResearcherResult } from '../lib/model';
import { assessFirstAuthor, withResearcher, restoreResearcherLinks, mergeResearcherReferences } from '../lib/authorship';
import { normalizedTitle } from '../lib/title-matching';
import { publicationsFromRows } from '../lib/files';
import { fromOrcid, enrichCrossref } from '../lib/sources';
const ali:ResearcherResult={identity:{provider:'orcid',id:'0000-0002-1825-0097',name:'علی کریمی'},resolvedOrcid:'0000-0002-1825-0097',name:'علی کریمی',aliases:['Ali Karimi'],total:1,status:'complete',message:''};
const sara:ResearcherResult={...ali,identity:{provider:'orcid',id:'0000-0003-2625-9232',name:'Sara Rahimi'},resolvedOrcid:'0000-0003-2625-9232',name:'Sara Rahimi',aliases:['Sara Rahimi']};
function paper(key:string,owner=ali,extra:Partial<Publication>={}):Publication {
 return withResearcher({...blankPublication(),key,title:'Shared research: a study',sources:['Crossref'],authors:['Ali Karimi','Sara Rahimi'],...extra},owner);
}
test('same researcher: normalized titles select richest record and retain missing fields and provenance',()=>{
 const poor=paper('poor',ali,{title:'SHARED RESEARCH — A STUDY',year:'2021',date:'2021-01-02',sources:['ORCID']});
 const rich=paper('rich',{...ali,identity:{provider:'scopus',id:'7004212771',name:'علی کریمی'}},{journal:'Rich Journal',year:'2024',volume:'7',issue:'2',pages:'1-9',doi:'10.1234/rich',publisher:'Publisher'});
 const result=mergePublications([poor,rich]);assert.equal(result.length,1);assert.equal(result[0].recordKey,'rich');assert.equal(result[0].year,'2024');assert.equal(result[0].researchers.length,1);assert.equal(result[0].queriedIds.length,2);assert.deepEqual(result[0].sources,['ORCID','Crossref']);
 assert.equal(result[0].date,'2021-01-02');assert.deepEqual(mergePublications(result),result);assert.equal(mergePublications([rich,poor])[0].recordKey,'rich');
});
test('same article for distinct researchers stays as two rows with independent first-author status',()=>{
 const rows=mergePublications([paper('one',ali,{doi:'10.1234/shared'}),paper('two',sara,{doi:'10.1234/shared'}),paper('three',ali,{title:'Shared Research - A Study',doi:'10.1234/shared',volume:'10'})]);
 assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.key)).size,2);
 const a=rows.find(p=>p.researchers[0].orcid===ali.resolvedOrcid)!;const b=rows.find(p=>p.researchers[0].orcid===sara.resolvedOrcid)!;
 assert.equal(assessFirstAuthor(a,a.researchers[0]).firstAuthor,true);assert.equal(assessFirstAuthor(b,b.researchers[0]).firstAuthor,false);assert.equal(b.volume,'');
 assert.equal(mergePublications(rows).length,2);
});
test('legacy globally merged records expand into a separate row for each owner',()=>{
 const global=withResearcher(paper('legacy'),sara);const rows=mergePublications([global]);assert.equal(rows.length,2);assert.ok(rows.every(p=>p.researchers.length===1));
 const old={...blankPublication(),key:'old',title:'Legacy',queriedIds:['orcid:'+ali.identity.id,'orcid:'+sara.identity.id],orcids:[ali.identity.id,sara.identity.id]};
 assert.equal(mergePublications([restoreResearcherLinks(old,[ali,sara])]).length,2);
});
test('an unlinked full name resolves to a unique known researcher but cannot bridge distinct ORCIDs',()=>{
 const unlinked={...ali,identity:{provider:'scholar' as const,id:'jD_4h7sAAAAJ',name:'Ali Karimi'},resolvedOrcid:undefined,name:'Ali Karimi'};
 assert.equal(mergePublications([paper('a'),paper('b',unlinked)]).length,1);
 const sameName={...sara,name:'Ali Karimi',aliases:['Ali Karimi'],identity:{...sara.identity,name:'Ali Karimi'}};
 assert.equal(mergePublications([paper('a'),paper('b',sameName),paper('c',unlinked)]).length,3);
 const refs=mergeResearcherReferences([paper('a').researchers[0],paper('b',sameName).researchers[0]]);assert.equal(refs.length,2);
});
test('incremental dedup does not mistake combined sparse records for a more complete original',()=>{
 const a=paper('a',ali,{journal:'Sparse journal',year:'2020'});const b=paper('b',ali,{volume:'1',issue:'1'});
 const rich=paper('rich',ali,{journal:'Rich journal',year:'2025',volume:'9'});
 assert.equal(mergePublications([...mergePublications([a,b]),rich])[0].recordKey,'rich');
});
test('title normalization, generic headings, empty titles and different titles',()=>{
 assert.equal(normalizedTitle('Study: A &amp; B'),normalizedTitle('STUDY — A & B'));
 assert.equal(normalizedTitle('بررسي كیفي'),normalizedTitle('بررسی کیفی'));
 assert.equal(mergePublications([paper('a',ali,{title:'Editorial'}),paper('b',ali,{title:'Editorial'})]).length,2);
 assert.equal(mergePublications([paper('a',ali,{title:'عنوان در منبع ثبت نشده'}),paper('b',ali,{title:'عنوان در منبع ثبت نشده'})]).length,2);
 assert.equal(mergePublications([paper('a',ali,{title:'A study in cats'}),paper('b',ali,{title:'A study in dogs'})]).length,2);
});
test('authorship uses exact ORCID, full-name inversion and ordered authors; initials and conflicts stay unknown',()=>{
 const p=paper('a',ali,{authorDetails:[{name:'A Karimi',orcid:ali.resolvedOrcid!,position:'first',source:'Crossref'}]});
 assert.equal(assessFirstAuthor(p,p.researchers[0]).firstAuthor,true);
 assert.equal(assessFirstAuthor(paper('b',ali,{authors:['Karimi, Ali','Sara Rahimi']}),p.researchers[0]).firstAuthor,true);
 assert.equal(assessFirstAuthor(paper('c',ali,{authors:['A Karimi']}),p.researchers[0]).firstAuthor,null);
 assert.equal(assessFirstAuthor(paper('d',ali,{sources:['ORCID']}),p.researchers[0]).firstAuthor,null);
 p.authorDetails.push({...p.authorDetails[0],position:'additional',source:'ORCID'});assert.equal(assessFirstAuthor(p,p.researchers[0]).firstAuthor,null);
});
test('source metadata preserves contributor identity and explicit sequence; editors are excluded',()=>{
 const p=fromOrcid({'put-code':1,contributors:{contributor:[{'credit-name':{value:'Ali Karimi'},'contributor-orcid':{path:ali.resolvedOrcid},'contributor-attributes':{'contributor-sequence':'first'}},{'credit-name':{value:'Editor Person'},'contributor-attributes':{'contributor-role':'editor'}}]}},ali.identity,ali.resolvedOrcid!);
 assert.deepEqual(p.authors,['Ali Karimi']);assert.equal(p.authorDetails[0].position,'first');
 p.doi='10.1234/test';const enriched=enrichCrossref(p,{DOI:p.doi,author:[{given:'Sara',family:'Rahimi',sequence:'additional',ORCID:'https://orcid.org/'+sara.resolvedOrcid},{given:'Ali',family:'Karimi',sequence:'first',ORCID:'https://orcid.org/'+ali.resolvedOrcid}]});
 const owned=withResearcher(enriched,ali);assert.equal(assessFirstAuthor(owned,owned.researchers[0]).firstAuthor,true);
});
test('publication file owners keep shared titles distinct, while duplicate rows for each owner collapse',()=>{
 const rows=publicationsFromRows([{Title:'Shared',Authors:'Ali Karimi; Sara Rahimi','Researcher Name':'Ali Karimi'},{Title:'SHARED',Authors:'Ali Karimi; Sara Rahimi','Researcher Name':'Ali Karimi',Volume:'4'},{Title:'Shared',Authors:'Ali Karimi; Sara Rahimi','Researcher Name':'Sara Rahimi'}],'shared.csv').publications;
 const merged=mergePublications(rows);assert.equal(merged.length,2);assert.equal(merged.find(p=>p.researchers[0].name==='Ali Karimi')?.volume,'4');
});
