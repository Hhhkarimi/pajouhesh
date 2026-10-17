import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { blankPublication, identityKey, safeUrl, type Identity, type CollectResponse } from './model';
import { fetchHtml, SourceError } from './http';

export function parseScholarProfile(html: string, identity: Identity): CollectResponse {
  const $ = load(html); const name = $('#gsc_prf_in').text().trim();
  if ($('#gs_captcha_ccl, form[action*="/sorry/"]').length || /unusual traffic|automated queries|not a robot/i.test($('title').text()+' '+$('body').text().slice(0,500))) {
    throw new SourceError('Google Scholar', 429, 'Google Scholar دسترسی خودکار را محدود کرده است؛ ORCID متناظر را وارد کنید یا فایل CSV پروفایل را بارگذاری کنید.');
  }
  if (!name || !$('#gsc_a_t').length) throw new SourceError('Google Scholar', 502, 'صفحه عمومی Google Scholar قابل خواندن نیست؛ ممکن است پروفایل خصوصی، مسدود یا ساختار صفحه تغییر کرده باشد.');
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical) {
    try { if (new URL(canonical).searchParams.get('user') !== identity.id) throw new Error('mismatch'); }
    catch { throw new SourceError('Google Scholar',409,'شناسه صفحه Scholar با ورودی یکسان نیست؛ دریافت متوقف شد.'); }
  }
  const profileUrl = `https://scholar.google.com/citations?user=${encodeURIComponent(identity.id)}`;
  const publications: CollectResponse['publications'] = []; let malformed = false;
  $('#gsc_a_b .gsc_a_tr').each((index, element) => {
    const row = $(element); const title = row.find('.gsc_a_at').text().trim();
    if (!title) { malformed = true; return; }
    const p = blankPublication(); const href = row.find('.gsc_a_at').attr('href') || '';
    let articleUrl = '';
    try { const u = new URL(href,profileUrl); if(u.hostname === 'scholar.google.com' && u.searchParams.get('user') === identity.id) articleUrl = safeUrl(u.href); } catch { /* No arbitrary links enter the result. */ }
    const originalAuthors = row.find('.gsc_a_t .gs_gray').eq(0).text().trim();
    p.key = `scholar:${identity.id}:${articleUrl || `${index}:${title}`}`; p.title = title;
    p.authors = originalAuthors.split(/\s*[,;]\s*/).filter(Boolean);
    p.originalPublication = row.find('.gsc_a_t .gs_gray').eq(1).text().trim();
    p.year = row.find('.gsc_a_y .gsc_a_h, .gsc_a_y span').first().text().trim();
    p.url = articleUrl || profileUrl; p.sources = ['Google Scholar']; p.queriedIds = [identityKey(identity)];
    p.notes = ['اطلاعات از ردیف عمومی Scholar خوانده شده؛ نام نویسندگان ممکن است مخفف یا کوتاه‌شده باشد. مشخصات ترکیبی انتشار بدون حدس نگه داشته شده است.'];
    publications.push(p);
  });
  const more = $('#gsc_bpf_more');
  if (!publications.length && !$('#gsc_a_b .gsc_a_e').length) throw new SourceError('Google Scholar',502,'ساختار فهرست آثار Scholar قابل تشخیص نیست؛ نتیجه خالی به‌عنوان دریافت موفق ثبت نشد.');
  const hasMore = publications.length >= 100 || (more.length > 0 && more.attr('disabled') === undefined && !more.hasClass('gs_dis'));
  const warnings = [
    ...(hasMore ? ['فقط صفحه عمومی اول Scholar (حداکثر ۱۰۰ اثر) دریافت شد؛ برای دریافت تمام آثار فایل خروجی CSV را وارد کنید.'] : []),
    ...(malformed ? ['برخی ردیف‌های Scholar قابل خواندن نبودند؛ نتیجه جزئی است.'] : [])
  ];
  return {
    researcher: { identity, name: identity.name || name, resolution: 'scholar-public', total: publications.length, status: hasMore || malformed ? 'partial' : 'complete', message: `دریافت مستقیم ${publications.length} ردیف از صفحه عمومی Google Scholar. نام‌های کامل نویسندگان، DOI، جلد و شماره ممکن است در این صفحه ثبت نشده باشند.` },
    publications, nextOffset: null, warnings, snapshot: createHash('sha256').update(publications.map(p=>p.key).join('\n')).digest('hex').slice(0,24)
  };
}
export async function collectScholarProfile(identity: Identity): Promise<CollectResponse> {
  // This public profile path is allowed by Scholar's robots.txt. Pagination with cstart is disallowed and is never requested.
  const url = `https://scholar.google.com/citations?user=${encodeURIComponent(identity.id)}&hl=en&pagesize=100`;
  return parseScholarProfile(await fetchHtml(url, 'Google Scholar'), identity);
}
