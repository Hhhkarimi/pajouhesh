import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectPage } from '../lib/sources';
import type { Identity } from '../lib/model';
import { personMatchesIdentity, resolveIdentityWithReport } from '../lib/identity-resolution';
import { normalizeId, idError } from '../lib/identifiers';
import { parseScholarProfile } from '../lib/scholar';

for (const identity of [
  { provider: 'scopus', id: '7004212771', name: '' },
  { provider: 'wos', id: 'A-1234-2010', name: '' },
  { provider: 'scholar', id: 'aBcDeFgHiJkL', name: '' }
] satisfies Identity[]) {
  test(`${identity.provider}: an exact ORCID public identifier works even when Wikidata has no entry`, { concurrency: false }, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('wikidata')) return Response.json({ results: { bindings: [] } });
      if (url.includes('/search/') || url.includes('/expanded-search/')) return Response.json({
        'num-found': 1, result: [{ 'orcid-identifier': { path: '0000-0002-1825-0097' } }],
        'expanded-result': [{ 'orcid-id': '0000-0002-1825-0097' }]
      });
      if (url.endsWith('/person')) return Response.json({
        name: { 'credit-name': { value: 'Regression fixture' } },
        'external-identifiers': { 'external-identifier': [{
          'external-id-type': {scopus:'Scopus Author ID',wos:'ResearcherID',scholar:'Google Scholar'}[identity.provider],
          'external-id-value': identity.id
        }] }
      });
      if (url.endsWith('/works')) return Response.json({ group: [{ 'work-summary': [{ 'put-code': 1, title: {title:{value:'Regression fixture article'}} }] }] });
      return Response.json({ 'put-code': 1, title: {title:{value:'Regression fixture article'}} });
    };
    try {
      const result = await collectPage({ identity, offset: 0, enrich: false });
      assert.equal(result.publications.length, 1, 'A valid external ID must not stop at an empty Wikidata lookup');
      assert.equal(result.researcher.resolvedOrcid, '0000-0002-1825-0097');
    } finally { globalThis.fetch = original; }
  });
}

test('provider URLs normalize without accepting a lookalike Scholar domain',()=>{
  assert.equal(normalizeId('scopus','http://www.scopus.com/inward/authorDetails.url?authorID=7004212771'),'7004212771');
  assert.equal(normalizeId('wos','http://www.researcherid.com/rid/A-2363-2010'),'A-2363-2010');
  assert.equal(normalizeId('wos','\u200eA-2363-2010\u200f'),'A-2363-2010');
  const evil=normalizeId('scholar','https://scholar.google.com.evil.example/citations?user=aBcDeFgHiJkL');
  assert.ok(idError('scholar',evil));
});
test('ORCID candidates must contain the exact provider ID, not a partial match or another namespace',()=>{
 const identity:Identity={provider:'scopus',id:'7004212771',name:''};
 assert.equal(personMatchesIdentity({'external-identifiers':{'external-identifier':[{'external-id-type':'Scopus Author ID','external-id-value':'170042127710'}]}},identity),false);
 assert.equal(personMatchesIdentity({'external-identifiers':{'external-identifier':[{'external-id-type':'Other','external-id-value':identity.id}]}},identity),false);
 assert.equal(personMatchesIdentity({'researcher-urls':{'researcher-url':[{url:{value:'https://scholar.google.com/citations?user=aBcDeFgHiJkL'}}]}},{provider:'scholar',id:'aBcDeFgHiJkL',name:''}),true);
});
test('Wikidata outage does not prevent an exact ORCID registry match',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(input)=>{
   const url=String(input);if(url.includes('wikidata'))return new Response('',{status:503});
   if(url.includes('/search/'))return Response.json({'num-found':1,result:[{'orcid-identifier':{path:'0000-0002-1825-0097'}}]});
   return Response.json({'external-identifiers':{'external-identifier':[{'external-id-type':'ResearcherID','external-id-value':'A-1234-2010'}]}});
 };
 try{const report=await resolveIdentityWithReport({provider:'wos',id:'A-1234-2010',name:''});assert.equal(report.match?.orcid,'0000-0002-1825-0097');assert.equal(report.match?.resolution,'orcid-search');assert.equal(report.warnings.length,1);}finally{globalThis.fetch=original;}
});
test('conflicting ORCID/Wikidata mappings are never silently chosen',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(input)=>{
   const url=String(input);if(url.includes('wikidata'))return Response.json({results:{bindings:[{orcid:{value:'0000-0003-2625-9232'}}]}});
   if(url.includes('/search/'))return Response.json({'num-found':1,result:[{'orcid-identifier':{path:'0000-0002-1825-0097'}}]});
   return Response.json({'external-identifiers':{'external-identifier':[{'external-id-type':'Scopus Author ID','external-id-value':'7004212771'}]}});
 };
 try{const report=await resolveIdentityWithReport({provider:'scopus',id:'7004212771',name:''});assert.equal(report.match,null);assert.equal(report.ambiguous,true);}finally{globalThis.fetch=original;}
});
const scholarIdentity:Identity={provider:'scholar',id:'aBcDeFgHiJkL',name:''};
const scholarHtml=(extra='',rows=1):string=>`<link rel="canonical" href="https://scholar.google.com/citations?user=aBcDeFgHiJkL"><div id="gsc_prf_in">Public Profile Fixture</div><table id="gsc_a_t"><tbody id="gsc_a_b">${Array.from({length:rows},(_,i)=>`<tr class="gsc_a_tr"><td class="gsc_a_t"><a class="gsc_a_at" href="/citations?user=aBcDeFgHiJkL&amp;citation_for_view=aBcDeFgHiJkL:${i}">Public paper ${i}</a><div class="gs_gray">A Author, B Author</div><div class="gs_gray">Journal 4 (2), 1-9</div></td><td class="gsc_a_y"><span class="gsc_a_h">2024</span></td></tr>`).join('')}</tbody></table>${extra}`;
test('Scholar without any ORCID link falls back to its public profile; no cstart pagination is requested',async()=>{
 const original=globalThis.fetch;const requested:string[]=[];
 globalThis.fetch=async(input)=>{const url=String(input);requested.push(url);if(url.includes('scholar.google.com'))return new Response(scholarHtml('<button id="gsc_bpf_more" disabled>More</button>'),{headers:{'content-type':'text/html; charset=utf-8'}});if(url.includes('wikidata'))return Response.json({results:{bindings:[]}});return Response.json({result:[],'num-found':0});};
 try{const result=await collectPage({identity:scholarIdentity,offset:0,enrich:false});assert.equal(result.publications.length,1);assert.deepEqual(result.publications[0].sources,['Google Scholar']);assert.equal(result.researcher.resolution,'scholar-public');assert.equal(result.publications[0].originalPublication,'Journal 4 (2), 1-9');assert.equal(result.publications[0].journal,'');assert.ok(requested.every(url=>!url.includes('cstart')));}finally{globalThis.fetch=original;}
});
test('Scholar reports incomplete pages, CAPTCHA, unexpected layouts and mismatched profiles',()=>{
 assert.equal(parseScholarProfile(scholarHtml('<button id="gsc_bpf_more">More</button>',100),scholarIdentity).researcher.status,'partial');
 assert.throws(()=>parseScholarProfile('<title>Sorry</title><div id="gs_captcha_ccl"></div>',scholarIdentity),/محدود/);
 assert.throws(()=>parseScholarProfile('<html>blocked</html>',scholarIdentity),/قابل خواندن نیست/);
 assert.throws(()=>parseScholarProfile(scholarHtml('',0),scholarIdentity),/ساختار فهرست/);
 assert.throws(()=>parseScholarProfile(scholarHtml().replace('user=aBcDeFgHiJkL','user=zzzzzzzzzzzz'),scholarIdentity),/یکسان نیست/);
});
