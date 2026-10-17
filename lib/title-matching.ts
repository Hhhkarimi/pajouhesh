export function normalizedTitle(value:string):string {
  const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity:string)=>{
    if(!entity.startsWith('#'))return entities[entity.toLowerCase()]||'';
    const code=entity.toLowerCase().startsWith('#x')?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
    return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';
  }).replace(/<[^>]*>/g,'').normalize('NFKC').toLowerCase().replace(/[يى]/g,'ی').replace(/ك/g,'ک')
    .replace(/[\u0640\u064B-\u065F\u0670]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
export function usableTitle(value:string):boolean { return !!value&&value!=='عنوان در منبع ثبت نشده'; }
