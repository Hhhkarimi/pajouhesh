import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseManual, normalizeId, validOrcid } from '../lib/identifiers';
import { blankPublication, mergePublications, safeUrl } from '../lib/model';
import { parseCsv, identitiesFromRows, publicationsFromRows } from '../lib/files';
import { fromOrcid, enrichCrossref, collectPage, resolveIdentity, type OrcidWork } from '../lib/sources';
import { POST } from '../app/api/collect/route';
const id='0000-0002-1825-0097';
test('ORCID check digit, Persian digits, URL normalization and mixed invalid input',()=>{
 assert.equal(validOrcid(id),true);assert.equal(validOrcid('0000-0002-1825-0098'),false);
 assert.equal(normalizeId('orcid','https://orcid.org/'+id),id);
 assert.equal(normalizeId('scholar','https://scholar.google.com/citations?user=aBcDeFgHiJkL&hl=en'),'aBcDeFgHiJkL');
 assert.equal(normalizeId('scopus','۷۰۰۴۲۱۲۷۷۱'),'7004212771');
 const parsed=parseManual('orcid',`${id}\n${id}\nbad`);assert.equal(parsed.identities.length,1);assert.equal(parsed.errors.length,1);
});
test('CSV quoted commas, escaped quotes, multiline titles, TSV and semicolon',()=>{
 const r=parseCsv('\uFEFFTitle,Authors,Year\r\n"A, B\nand C","X; Y",2024\r\n"A ""quote""",Z,2020');
 assert.equal(r[0]['Title'],'A, B\nand C');assert.equal(r[1]['Title'],'A "quote"');
 assert.equal(parseCsv('Title;Year\nhello;2024')[0].Year,'2024');
 assert.equal(parseCsv('Title\tYear\nhello\t2024')[0].Year,'2024');
 assert.throws(()=>parseCsv('Title\n"unclosed'));
});
test('wide identity spreadsheet and mapped ORCID; invalid rows isolated',()=>{
 const result=identitiesFromRows([{Name:'Test',ORCID:id,'Scopus Author ID':'7004212771'},{ORCID:'bad'}]);
 assert.equal(result.identities.length,2);assert.equal(result.identities.find(i=>i.provider==='scopus')?.orcid,id);assert.equal(result.errors.length,1);
 const narrow=identitiesFromRows([{type:'scholar',id:'aBcDeFgHiJkL'}]);assert.equal(narrow.identities.length,1);
});
test('source exports preserve Google Publication and reject missing titles',()=>{
 const {publications,errors}=publicationsFromRows([{Title:'Example',Authors:'A; B',Publication:'Journal 3 (2), 1-5',Year:'2024',DOI:'https://doi.org/10.1234/ABC',URL:'javascript:alert(1)'},{Title:''}],'source.csv');
 assert.equal(publications[0].originalPublication,'Journal 3 (2), 1-5');assert.equal(publications[0].journal,'');
 assert.deepEqual(publications[0].authors,['A','B']);assert.equal(publications[0].doi,'10.1234/abc');assert.equal(errors.length,1);assert.equal(safeUrl('javascript:alert(1)'),'');
});
test('deduplication uses exact DOI or stable source key; merges provenance',()=>{
 const a={...blankPublication(),key:'a',title:'Same title',doi:'10.1234/ABC',sources:['ORCID'],queriedIds:['orcid:one']};
 const b={...blankPublication(),key:'b',title:'Same title',doi:'https://doi.org/10.1234/abc',volume:'9',authors:['A'],sources:['Crossref'],queriedIds:['scopus:two']};
 const result=mergePublications([a,b]);assert.equal(result.length,1);assert.equal(result[0].volume,'9');assert.deepEqual(result[0].sources,['ORCID','Crossref']);assert.equal(result[0].queriedIds.length,2);
 assert.equal(mergePublications([{...a,doi:''},{...b,doi:''}]).length,2);
});
test('Crossref enriches exact DOI only; no fabricated authors',()=>{
 const work:OrcidWork={'put-code':1,title:{title:{value:'Paper'}},'publication-date':{year:{value:'2024'}},'external-ids':{'external-id':[{'external-id-type':'doi','external-id-value':'10.1234/example','external-id-relationship':'self'}]}};
 const p=fromOrcid(work,{provider:'orcid',id,name:''},id);assert.equal(p.authors.length,0);
 const enriched=enrichCrossref(p,{DOI:'10.1234/example',author:[{given:'Ali',family:'Karimi'}],volume:'2',issue:'3',page:'1-5'});
 assert.deepEqual(enriched.authors,['Ali Karimi']);assert.equal(enriched.issue,'3');assert.equal(enrichCrossref(p,{DOI:'10.1234/other',volume:'100'}).volume,'');
});
test('paginated collection, snapshot consistency, upstream failures and ambiguous mapping',{concurrency:false},async()=>{
 const original=globalThis.fetch;let groups=Array.from({length:6},(_,i)=>({'work-summary':[{'put-code':i+1,title:{title:{value:`Paper ${i+1}`}},'display-index':'1'}]}));
 globalThis.fetch=async(url)=>{
   const u=String(url);if(u.includes('wikidata'))return Response.json({results:{bindings:[{orcid:{value:id}},{orcid:{value:'0000-0003-2625-9232'}}]}});
   if(u.endsWith('/works'))return Response.json({group:groups,'last-modified-date':{value:1}});
   if(u.includes('/work/3'))return new Response('',{status:404});
   return Response.json({'put-code':Number(u.split('/').pop()),title:{title:{value:'Details'}}});
 };
 try{
  const first=await collectPage({identity:{provider:'orcid',id,name:''},offset:0,enrich:false});assert.equal(first.publications.length,4);assert.equal(first.nextOffset,4);assert.equal(first.researcher.status,'partial');assert.equal(first.warnings.length,1);
  const second=await collectPage({identity:{provider:'orcid',id,name:''},offset:4,resolvedOrcid:id,snapshot:first.snapshot,enrich:false});assert.equal(second.publications.length,2);assert.equal(second.nextOffset,null);
  groups=groups.slice(1);await assert.rejects(()=>collectPage({identity:{provider:'orcid',id,name:''},offset:4,resolvedOrcid:id,snapshot:first.snapshot,enrich:false}),/تغییر کرد/);
  assert.equal(await resolveIdentity({provider:'scopus',id:'7004212771',name:''}),null);
 }finally{globalThis.fetch=original;}
});
test('HTTP boundary rejects invalid JSON, IDs, cross-origin requests and oversized bodies',async()=>{
 const send=(body:string,headers:Record<string,string>={}):Promise<Response>=>POST(new Request('http://localhost/api/collect',{method:'POST',headers:{'Content-Type':'application/json',...headers},body}));
 assert.equal((await send('broken')).status,400);assert.equal((await send(JSON.stringify({identity:{provider:'orcid',id:'bad'}}))).status,400);
 assert.equal((await send('{}',{Origin:'https://untrusted.example'})).status,403);assert.equal((await send(' '.repeat(9000))).status,413);
 const internalUrl=new Request('http://localhost:3000/api/collect',{method:'POST',headers:{'Content-Type':'application/json',Host:'127.0.0.1:3000',Origin:'http://127.0.0.1:3000'},body:'{}'});
 assert.equal((await POST(internalUrl)).status,400); // Schema failure, never a false cross-origin rejection.
});
