import { test, expect } from '@playwright/test';
import { blankPublication } from '../../lib/model';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
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
for(const width of [320,375,414,768,1280,1920])test(`responsive workspace at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/');await page.evaluate(()=>document.fonts.ready);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('heading',{name:'آثار پژوهشی، یک‌جا.'})).toBeVisible();
 await page.screenshot({path:`test-results/workspace-${width}.png`,fullPage:true});
});
