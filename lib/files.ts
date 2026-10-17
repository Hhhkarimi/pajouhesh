import { blankPublication, identityKey, normalizeDoi, safeUrl, resolutionNames, type Identity, type Provider, type Publication, type ResearcherResult } from './model';
import { identitySchema } from './identifiers';

export type SheetRow = Record<string, string>;
const normalizeHeader = (v: string): string => v.toLowerCase().replace(/[\s_\-\u200c]+/g, '').replaceAll('ي','ی').replaceAll('ك','ک').replace(/^\uFEFF/,'');
export function cell(row: SheetRow, ...headers: string[]): string {
  const keys = headers.map(normalizeHeader);
  const entry = Object.entries(row).find(([k]) => keys.includes(normalizeHeader(k)));
  return entry?.[1]?.trim() || '';
}
export function parseCsv(text: string): SheetRow[] {
  // RFC 4180 quoted cells, embedded newlines, escaped quotes, comma/semicolon/tab exports.
  const firstLine = text.split(/\r?\n/)[0];
  const separator = firstLine.includes('\t') ? '\t' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i+1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (ch === separator && !quoted) { row.push(field); field = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i+1] === '\n') i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('نقل‌قول‌های فایل CSV بسته نشده‌اند.');
  row.push(field); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((header,i)=>[header.trim(), values[i] || ''])));
}
export async function readRows(file: File): Promise<SheetRow[]> {
  if (file.size > 5 * 1024 * 1024) throw new Error('حجم فایل باید کمتر از ۵ مگابایت باشد.');
  if (/\.(csv|tsv)$/i.test(file.name)) return parseCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new Error('فایل XLSX، CSV یا TSV انتخاب کنید. فایل XLS قدیمی را به XLSX تبدیل کنید.');
  const ExcelJS = await import('exceljs'); const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0]; if (!ws) throw new Error('فایل صفحه‌ای ندارد.');
  if (ws.rowCount > 10001 || ws.columnCount > 100) throw new Error('فایل باید حداکثر ۱۰٬۰۰۰ ردیف و ۱۰۰ ستون داشته باشد.');
  const headers: string[] = [];
  ws.getRow(1).eachCell({includeEmpty: true}, (value, index) => { headers[index] = value.text; });
  const rows: SheetRow[] = [];
  ws.eachRow((r,i) => {
    if (i === 1) return;
    const row: SheetRow = {};
    for (let j = 1; j < headers.length; j++) if (headers[j]) row[headers[j]] = r.getCell(j).text;
    if (Object.values(row).some(Boolean)) rows.push(row);
  });
  return rows;
}
const idHeaders: Record<Provider, string[]> = {
  orcid: ['ORCID','ORCID ID','شناسه اورکید'], scopus: ['Scopus','Scopus Author ID','Scopus ID'],
  wos: ['WoS','WoS Researcher ID','ResearcherID'], scholar: ['Scholar','Google Scholar ID','Google Scholar User ID','Scholar ID']
};
export function identitiesFromRows(rows: SheetRow[]): { identities: Identity[]; errors: string[] } {
  if (rows.length > 500) throw new Error('در فایل شناسه‌ها حداکثر ۵۰۰ ردیف مجاز است.');
  const identities: Identity[] = []; const errors: string[] = [];
  rows.forEach((row,index) => {
    const name = cell(row,'name','نام','نام پژوهشگر'); const orcid = cell(row,...idHeaders.orcid);
    const type = cell(row,'type','provider','نوع').toLowerCase();
    const raw = cell(row,'id','شناسه');
    const entries: [Provider, string][] = type && raw ? [[type as Provider, raw]] : (Object.keys(idHeaders) as Provider[]).map(p=>[p,cell(row,...idHeaders[p])]);
    let found = false;
    for (const [provider,id] of entries) {
      if (!id) continue; found = true;
      const result = identitySchema.safeParse({provider,id,name,orcid: provider === 'orcid' ? undefined : (orcid || undefined)});
      if (result.success) identities.push(result.data);
      else errors.push(`ردیف ${index+2}: ${result.error.issues[0].message}`);
    }
    if (!found) errors.push(`ردیف ${index+2}: ستونی با نام ORCID، Scopus Author ID، WoS Researcher ID، Google Scholar ID یا دو ستون type و id لازم است.`);
  });
  const unique = [...new Map(identities.map(i=>[identityKey(i),i])).values()];
  if (unique.length > 500) throw new Error('حداکثر ۵۰۰ شناسه در هر فهرست مجاز است.');
  return { identities: unique, errors };
}
export function publicationsFromRows(rows: SheetRow[], filename: string): { publications: Publication[]; errors: string[] } {
  if (rows.length > 10000) throw new Error('در هر فایل حداکثر ۱۰٬۰۰۰ مقاله مجاز است.');
  const publications: Publication[] = []; const errors: string[] = [];
  rows.forEach((row,index)=>{
    const p = blankPublication();
    p.title = cell(row,'Title','Article Title','Document Title','عنوان','عنوان مقاله');
    if (!p.title) { errors.push(`ردیف ${index+2}: عنوان مقاله وجود ندارد.`); return; }
    p.key = `file:${filename}:${index}:${p.title}`;
    p.authors = cell(row,'Author Full Names','Authors','Author','نام نویسندگان','نویسندگان').split(/\s*;\s*/).filter(Boolean);
    p.journal = cell(row,'Journal','Source Title','Journal Title','نام ژورنال','نشریه');
    p.originalPublication = cell(row,'Publication','Original Publication','مشخصات انتشار اولیه');
    p.year = cell(row,'Year','Publication Year','سال','سال چاپ');
    p.volume = cell(row,'Volume','جلد'); p.issue = cell(row,'Issue','Number','شماره','شماره چاپ');
    p.pages = cell(row,'Pages','صفحات') || [cell(row,'Page start','Start Page'),cell(row,'Page end','End Page')].filter(Boolean).join('-');
    p.articleNumber = cell(row,'Article Number','شماره مقاله'); p.doi = normalizeDoi(cell(row,'DOI'));
    p.issn = cell(row,'ISSN'); p.publisher = cell(row,'Publisher','ناشر'); p.type = cell(row,'Document Type','Type','نوع اثر');
    p.url = safeUrl(cell(row,'URL','Link','لینک')) || (p.doi ? safeUrl(`https://doi.org/${p.doi}`) : '');
    p.date = cell(row,'Date','تاریخ انتشار'); p.sources = [`فایل: ${filename}`];
    p.queriedIds = cell(row,'Queried IDs','شناسه‌های ورودی').split(';').map(s=>s.trim()).filter(Boolean);
    p.orcids = cell(row,'ORCID','ORCID ID').split(';').map(s=>s.trim()).filter(Boolean);
    p.notes = ['از فایل کاربر وارد شده؛ انتساب مقاله به پژوهشگر به‌صورت خودکار تأیید نشده است.'];
    publications.push(p);
  });
  return { publications, errors };
}
async function saveWorkbook(wb: import('exceljs').Workbook, filename: string): Promise<void> {
  const data = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a = document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),3000);
}
export async function downloadTemplate(): Promise<void> {
  const ExcelJS = await import('exceljs'); const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('شناسه‌ها', {views:[{rightToLeft:true,state:'frozen',ySplit:1}]});
  ws.columns = [{header:'Name',key:'name',width:26},{header:'ORCID',key:'orcid',width:27},{header:'Scopus Author ID',key:'scopus',width:25},{header:'WoS Researcher ID',key:'wos',width:25},{header:'Google Scholar ID',key:'scholar',width:25}];
  ws.addRow({name:'Josiah Carberry (پروفایل نمونه ORCID)',orcid:'0000-0002-1825-0097'});
  ws.getRow(1).font={bold:true}; ws.eachRow(r=>r.eachCell(c=>{c.numFmt='@';}));
  const help = wb.addWorksheet('راهنما',{views:[{rightToLeft:true}]}); help.getColumn(1).width=110;
  ['در هر ردیف شناسه‌های یک پژوهشگر؛ فقط یک ستون شناسه هم کافی است.','ORCID کنار شناسه‌های دیگر، نگاشت اعلام‌شده توسط شماست و انتساب را مستقلاً تأیید نمی‌کند.','Scopus و Google Scholar را با قالب Text وارد کنید. حداکثر ۵۰۰ شناسه.','ردیف نمونه را با داده خود جایگزین کنید. همه شناسه‌ها اختیاری‌اند، اما هر ردیف باید حداقل یکی داشته باشد.'].forEach(t=>help.addRow([t]));
  await saveWorkbook(wb,'pajouhesh-identifiers-template.xlsx');
}
export async function exportWorkbook(publications: Publication[], researchers: ResearcherResult[], warnings: string[]): Promise<void> {
  const ExcelJS = await import('exceljs'); const wb = new ExcelJS.Workbook(); wb.creator='Pajouhesh';
  const ws = wb.addWorksheet('مقالات',{views:[{rightToLeft:true,state:'frozen',ySplit:1}]});
  const columns: [keyof Publication,string,number][] = [
    ['title','عنوان مقاله',65],['authors','نویسندگان',60],['journal','نام ژورنال',40],['year','سال',12],['volume','جلد',12],['issue','شماره',12],['pages','صفحات',18],['articleNumber','شماره مقاله',18],['doi','DOI',40],['issn','ISSN',24],['publisher','ناشر',30],['type','نوع اثر',25],['date','تاریخ انتشار',20],['url','URL',45],['sources','منابع',30],['queriedIds','شناسه‌های ورودی',40],['orcids','ORCID',30],['retrievedAt','زمان دریافت',25],['notes','یادداشت‌ها',70],['originalPublication','مشخصات انتشار اولیه',50]
  ];
  ws.columns=columns.map(([key,header,width])=>({key,header,width}));
  publications.forEach(p=>ws.addRow(Object.fromEntries(columns.map(([key])=>[key,Array.isArray(p[key]) ? p[key].join('; ') : p[key]]))));
  // All user/source values remain literal strings, never Excel formula objects.
  ws.autoFilter={from:'A1',to:{row:Math.max(1,ws.rowCount),column:columns.length}};
  const rs=wb.addWorksheet('وضعیت پژوهشگران',{views:[{rightToLeft:true}]});
  rs.columns=[{header:'نوع شناسه',key:'provider',width:20},{header:'شناسه',key:'id',width:30},{header:'نام',key:'name',width:30},{header:'ORCID متناظر',key:'orcid',width:28},{header:'روش تطبیق',key:'resolution',width:20},{header:'تعداد رکورد منبع',key:'total',width:22},{header:'وضعیت',key:'status',width:20},{header:'توضیح',key:'message',width:100}];
  researchers.forEach(r=>rs.addRow({provider:r.identity.provider,id:r.identity.id,name:r.name,orcid:r.resolvedOrcid,resolution:r.resolution?resolutionNames[r.resolution]:'',total:r.total,status:r.status,message:r.message}));
  const issues=wb.addWorksheet('گزارش و محدودیت‌ها',{views:[{rightToLeft:true}]}); issues.getColumn(1).width=120;
  ['پوشش آثار به داده عمومی ORCID و فایل‌های واردشده محدود است؛ همه مقالات همه پایگاه‌ها تضمین نمی‌شود.','نویسندگان، جلد، شماره و سایر داده‌های خالی در منابع در دسترس نبوده‌اند؛ مقدار حدسی تولید نشده است.','منابع در ستون منابع مشخص‌اند؛ ورود یک Scopus ID به معنی دریافت از Scopus نیست.','فقط DOI یکسان یا کلید یکسان اثر ادغام می‌شود؛ تشابه عنوان به‌تنهایی مبنای ادغام نیست.',...warnings].forEach(t=>issues.addRow([t]));
  for(const sheet of wb.worksheets){sheet.getRow(1).font={bold:true};sheet.eachRow(r=>r.eachCell(c=>{c.alignment={vertical:'top',wrapText:true};c.numFmt='@';}));}
  await saveWorkbook(wb,`pajouhesh-${new Date().toISOString().slice(0,10)}.xlsx`);
}
