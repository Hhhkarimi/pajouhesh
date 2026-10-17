import { test, expect } from '@playwright/test';
import { blankPublication } from '../../lib/model';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import type { Identity } from '../../lib/model';
test('manual queue, acquisition, filters, details, literal Excel export and persistence',async({page})=>{
 const records=[{...blankPublication(),key:'test:one',title:'A study of open research',authors:['Ali Karimi','Sara Rahimi'],journal:'Research Journal',year:'2024',volume:'5',issue:'2',sources:['ORCID','Crossref'],doi:'10.1234/test',queriedIds:['orcid:0000-0002-1825-0097']},{...blankPublication(),key:'test:two',title:'=A literal title',year:'2020',sources:['ORCID']}];
 await page.route('**/api/collect',route=>route.fulfill({json:{publications:records,researcher:{identity:{provider:'orcid',id:'0000-0002-1825-0097',name:''},resolvedOrcid:'0000-0002-1825-0097',resolution:'direct',name:'Test',total:2,status:'complete',message:'Test response'},nextOffset:null,warnings:[],snapshot:'test'}}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'آثار پژوهشی، یک‌جا.'})).toBeVisible();
 await page.getByLabel('ORCID iD',{exact:true}).fill('invalid');await page.getByRole('button',{name:'افزودن به فهرست'}).click();await expect(page.locator('#input-errors')).toContainText('رقم کنترل');
 await page.getByLabel('ORCID iD',{exact:true}).fill('0000-0002-1825-0097');await page.getByRole('button',{name:'افزودن به فهرست'}).click();await page.getByRole('button',{name:'دریافت آثار',exact:true}).click();
 await expect(page.getByRole('button',{name:'A study of open research',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'A study of open research',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Ali Karimi');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByLabel('فیلتر سال',{exact:true}).selectOption('2020');await expect(page.getByRole('button',{name:'A study of open research',exact:true})).toHaveCount(0);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:/دریافت اکسل/}).click();const download=await downloadPromise;const path=await download.path();const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path!);expect(wb.worksheets).toHaveLength(3);expect(wb.worksheets[0].getCell('A2').value).toBe('=A literal title');expect(wb.worksheets[0].rowCount).toBe(2);
 await page.getByLabel('نگهداری فهرست و نتیجه‌ها فقط در همین مرورگر').check();await page.reload();await expect(page.getByRole('button',{name:'A study of open research',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/گزارش دریافت و کیفیت داده/})).toContainText('۱');
});
test('spreadsheet template round trip and CSV publication import',async({page})=>{
 await page.goto('/');const dl=page.waitForEvent('download');await page.getByRole('button',{name:'دریافت قالب اکسل'}).click();const file=await dl;
 // Playwright's temporary download path is a UUID without an extension. Preserve the real downloaded filename.
 await page.getByLabel('فایل شناسه‌های پژوهشگران',{exact:true}).setInputFiles({name:file.suggestedFilename(),mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await readFile((await file.path())!)});
 await expect(page.getByText('Josiah Carberry (پروفایل نمونه ORCID)',{exact:true})).toBeVisible();
 await page.getByLabel('فایل مقالات',{exact:true}).setInputFiles({name:'papers.csv',mimeType:'text/csv',buffer:Buffer.from('Title,Authors,Year,Volume,Issue\n"A, B",A; B,2023,4,2')});await expect(page.getByRole('button',{name:'A, B',exact:true})).toBeVisible();
 await page.getByLabel('فایل شناسه‌های پژوهشگران',{exact:true}).setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('ORCID\nbad')});await expect(page.locator('#input-errors')).toBeVisible();
});
for (const example of [
 {provider:'scopus',id:'7004212771',tab:'Scopus',label:'Scopus Author ID'},
 {provider:'wos',id:'A-2363-2010',tab:'WoS',label:'WoS Researcher ID'},
 {provider:'scholar',id:'jD_4h7sAAAAJ',tab:'Scholar',label:'Google Scholar User ID'}
]) test(`${example.provider}: resolve an unsuccessful ID using its inline ORCID mapping`,async({page})=>{
 await page.route('**/api/collect',async route=>{
   const input=route.request().postDataJSON() as {identity:Identity}; const mapped=!!input.identity.orcid;
   await route.fulfill({json:{researcher:{identity:input.identity,resolvedOrcid:mapped?'0000-0002-1825-0097':undefined,resolution:mapped?'user':undefined,name:'',total:mapped?1:0,status:mapped?'complete':'unresolved',message:mapped?'Mapped profile received':'پیوند تأییدشده پیدا نشد.'},publications:mapped?[{...blankPublication(),key:`test:${example.provider}`,title:`Recovered ${example.provider} paper`,sources:['ORCID'],queriedIds:[`${example.provider}:${example.id}`]}]:[],nextOffset:null,warnings:[],snapshot:''}});
 });
 await page.goto('/');await page.getByRole('button',{name:example.tab,exact:true}).click();await page.getByLabel(example.label,{exact:true}).fill(example.id);await page.getByRole('button',{name:'افزودن به فهرست',exact:true}).click();await page.getByRole('button',{name:'دریافت آثار',exact:true}).click();
 await expect(page.getByText('نیازمند ORCID متناظر',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/گزارش دریافت و کیفیت داده/})).toHaveAttribute('aria-expanded','true');
 await page.getByText('تعیین ORCID متناظر',{exact:true}).click();await page.getByLabel(`ORCID متناظر برای ${example.id}`,{exact:true}).fill('0000-0002-1825-0097');await page.getByRole('button',{name:'ثبت ORCID',exact:true}).click();
 await page.getByRole('button',{name:'دریافت آثار',exact:true}).click();await expect(page.getByRole('button',{name:`Recovered ${example.provider} paper`,exact:true})).toBeVisible();
});
for(const width of [320,375,414,768,1280,1920])test(`responsive workspace at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/');await page.evaluate(()=>document.fonts.ready);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('heading',{name:'آثار پژوهشی، یک‌جا.'})).toBeVisible();
 await page.screenshot({path:`test-results/workspace-${width}.png`,fullPage:true});
});
test('duplicate titles collapse per researcher, preserving richest metadata and separate first-author checkboxes in Excel',async({page})=>{
 await page.goto('/');
 const buffer=Buffer.from('Title,Researcher Name,Authors,Journal,Year,Volume,Issue,DOI\nShared research: a study,Ali Karimi,Ali Karimi; Sara Rahimi,,2020,,,\nSHARED RESEARCH - A STUDY,Ali Karimi,Ali Karimi; Sara Rahimi,Complete Journal,2025,7,2,10.1234/shared\nShared research: a study,Sara Rahimi,Ali Karimi; Sara Rahimi,Other Journal,2024,3,1,10.1234/shared\nA separate work,Alex Smith,A Smith; B Jones,,2023,,,');
 await page.getByLabel('فایل مقالات',{exact:true}).setInputFiles({name:'shared.csv',mimeType:'text/csv',buffer});
 const rows=page.locator('.publications-table tbody tr');await expect(rows).toHaveCount(3);
 const ali=rows.filter({has:page.locator('.researcher-cell',{hasText:'Ali Karimi'})});const sara=rows.filter({has:page.locator('.researcher-cell',{hasText:'Sara Rahimi'})});
 await expect(ali).toContainText('Complete Journal');await expect(ali).toContainText('2025');await expect(ali.getByRole('checkbox')).toHaveAttribute('aria-checked','true');
 await expect(sara).toContainText('Other Journal');await expect(sara.getByRole('checkbox')).toHaveAttribute('aria-checked','false');await expect(rows.filter({hasText:'Alex Smith'}).getByRole('checkbox')).toHaveAttribute('aria-checked','mixed');
 await ali.getByRole('button',{name:'SHARED RESEARCH - A STUDY',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('تطابق کامل نام پژوهشگر');await page.keyboard.press('Escape');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:/دریافت اکسل/}).click();const file=await pending;const wb=new ExcelJS.Workbook();await wb.xlsx.readFile((await file.path())!);
 const sheet=wb.worksheets[0];expect(sheet.rowCount).toBe(4);expect(sheet.getCell('B1').text).toBe('نام پژوهشگر صاحب شناسه');expect(sheet.getCell('C1').text).toBe('نویسنده اول');
 const data=sheet.getRows(2,3)!;expect(data.find(r=>r.getCell(2).text==='Ali Karimi')?.getCell(3).text).toBe('☑ بله');expect(data.find(r=>r.getCell(2).text==='Sara Rahimi')?.getCell(3).text).toBe('☐ خیر');expect(data.find(r=>r.getCell(2).text==='Alex Smith')?.getCell(3).text).toBe('— نامشخص');
 await page.getByLabel('نگهداری فهرست و نتیجه‌ها فقط در همین مرورگر').check();await page.reload();await expect(rows).toHaveCount(3);await expect(page.getByRole('checkbox',{name:'نویسنده اول: Ali Karimi',exact:true})).toHaveAttribute('aria-checked','true');
 await page.setViewportSize({width:375,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('.results-area').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/shared-articles-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/shared-articles-desktop.png',fullPage:true});
});
test('multiple provider IDs merge for one owner while a second researcher keeps the same article',async({page})=>{
 await page.route('**/api/collect',async route=>{
   const {identity}=route.request().postDataJSON() as {identity:Identity};const isSara=identity.id==='0000-0003-2625-9232';const poor=identity.provider==='orcid'&&!isSara;
   await route.fulfill({json:{researcher:{identity,resolvedOrcid:isSara?'0000-0003-2625-9232':'0000-0002-1825-0097',name:identity.name,aliases:[isSara?'Sara Rahimi':'Ali Karimi'],total:1,status:'complete',message:''},publications:[{...blankPublication(),key:identity.provider+identity.id,title:poor?'Shared research: a study':'SHARED RESEARCH - A STUDY',authors:['Ali Karimi','Sara Rahimi'],sources:['Crossref'],volume:poor?'':'9',doi:'10.1234/shared',queriedIds:[`${identity.provider}:${identity.id}`]}],nextOffset:null,warnings:[],snapshot:'test'}});
 });
 await page.goto('/');await page.getByLabel('فایل شناسه‌های پژوهشگران',{exact:true}).setInputFiles({name:'ids.csv',mimeType:'text/csv',buffer:Buffer.from('Name,ORCID,Scopus Author ID,WoS Researcher ID,Google Scholar ID\nAli Karimi,0000-0002-1825-0097,7004212771,A-2363-2010,jD_4h7sAAAAJ\nSara Rahimi,0000-0003-2625-9232,,,')});
 await page.getByRole('button',{name:'دریافت آثار',exact:true}).click();await expect(page.getByRole('status').last()).toContainText('دریافت پایان یافت');await expect(page.locator('.publications-table tbody tr')).toHaveCount(2);
 await expect(page.getByRole('checkbox',{name:'نویسنده اول: Ali Karimi',exact:true})).toHaveAttribute('aria-checked','true');await expect(page.getByRole('checkbox',{name:'نویسنده اول: Sara Rahimi',exact:true})).toHaveAttribute('aria-checked','false');
});
test('legacy saved publications recover their owners and deduplicate on restore',async({page})=>{
 const identity={provider:'orcid',id:'0000-0002-1825-0097',name:'Ali Karimi'};
 const old=JSON.parse(JSON.stringify({...blankPublication(),key:'old',title:'Saved study',authors:['Ali Karimi','Sara Rahimi'],sources:['Crossref'],queriedIds:['orcid:'+identity.id],orcids:[identity.id]}));delete old.authorDetails;delete old.researchers;
 await page.addInitScript(value=>localStorage.setItem('pajouhesh-workspace-v1',JSON.stringify(value)),{queue:[identity],publications:[old,{...old,key:'old2',volume:'4'}],researchers:[{identity,resolvedOrcid:identity.id,name:'Ali Karimi',total:2,status:'complete',message:''}],warnings:[]});
 await page.goto('/');await expect(page.locator('.publications-table tbody tr')).toHaveCount(1);await expect(page.getByRole('checkbox',{name:'نویسنده اول: Ali Karimi',exact:true})).toHaveAttribute('aria-checked','true');
});
