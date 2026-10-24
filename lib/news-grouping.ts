export type NewsItem={title:string;description:string;link:string;date:string|null;source:string;category:string;feedId:string};
export type NewsGroup<T extends NewsItem>={article:T;related:T[]};
const WINDOW=48*60*60*1000;
export function canonicalNewsUrl(raw:string){try{const u=new URL(raw);u.hash='';for(const key of [...u.searchParams.keys()])if(/^(utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid|igshid)$/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href.replace(/\/$/,'')}catch{return raw.split('#')[0]}}
function clean(raw:string,source=''){let s=raw.normalize('NFKC').toLowerCase();if(source)s=s.replace(source.normalize('NFKC').toLowerCase(),'');return s.replace(/^\s*[\[【](속보|단독|종합|사진|영상|breaking|updated)[\]】]\s*/gi,'').replace(/영업익/g,'영업이익').replace(/\bearnings\b/g,'profit').replace(/\bannounces?\b/g,'announce').replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
function titleKey(a:NewsItem){return clean(a.title,a.source).replace(/\s/g,'')}
function grams(s:string){const compact=s.replace(/\s/g,'');const set=new Set<string>();for(let i=0;i<compact.length-1;i++)set.add(compact.slice(i,i+2));return set}
function dice(a:Set<string>,b:Set<string>){if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return 2*n/(a.size+b.size)}
function numbers(s:string){return [...s.normalize('NFKC').toLowerCase().matchAll(/\d[\d,]*(?:\.\d+)?\s*(?:조|억|만|천|원|달러|엔|%|퍼센트|년|월|일|분기|billion|million|trillion|percent|q[1-4])?/g)].map(m=>m[0].replace(/[,\s]/g,'')).sort().join('|')}
function status(s:string){s=s.replace(/(?:시장\s*)?예상(?:치)?(?:을|보다)?\s*(?:상회|하회|웃돌|밑돌|넘|초과)|(?:beat|exceed|miss)(?:s|ed)?\s+(?:market\s+)?expectations?/gi,'');if(/정정|수정공시|오보|철회|취소|correction|corrected|withdraw|cancel/i.test(s))return 'correction';if(/예상|전망|추정|예정|검토|협의|추진|forecast|expect|estimate|plans?\b|consider/i.test(s))return 'expected';return 'reported'}
const events=[/영업이익|매출|실적|profit|revenue|earnings/i,/계약|수주|공급|contract|supply|deal/i,/금리|기준금리|interest rate|rate cut|rate hike/i,/인수|합병|acquisition|merger/i,/출시|공개|신제품|launch|unveil/i,/투자|증설|공장|invest|factory|plant/i,/제재|관세|sanction|tariff/i,/주가|급등|급락|shares|stock/i];
function eventSet(s:string){return new Set(events.flatMap((r,i)=>r.test(s)?[String(i)]:[]))}
const aliases=[['삼성전자','samsung electronics'],['엔비디아','nvidia'],['테슬라','tesla'],['애플','apple'],['sk하이닉스','sk hynix'],['마이크로소프트','microsoft'],['현대차','현대자동차','hyundai'],['구글','google'],['아마존','amazon'],['메타','meta'],['연준','fed','federal reserve']];
const generic=new Set(['뉴스','경제','주식','시장','기업','정부','미국','한국','일본','중국','news','market','stocks','shares','the','a','an','of','to','in','for','and','on','with','as','at','by','is','it','new','this','that','announce','profit','revenue','실적','영업이익','매출','계약','발표','전망','예상','종합']);
function anchors(s:string){const keys=new Set<string>();for(let i=0;i<aliases.length;i++)if(aliases[i].some(n=>s.includes(n)))keys.add('entity:'+i);for(const t of s.split(/\s+/)){const x=t.replace(/(?:은|는|이|가|의|을|를|와|과)$/,'');if(x.length>=3&&!generic.has(x)&&!/^\d/.test(x))keys.add(x)}return keys}
function intersect(a:Set<string>,b:Set<string>){for(const x of a)if(b.has(x))return true;return false}
function profile(a:NewsItem){const title=clean(a.title,a.source),body=clean(a.description,a.source);return {title:grams(title),body:grams(body),anchors:anchors(title),events:eventSet(title),numbers:numbers(a.title),status:status(a.title),bodyNumbers:numbers(a.description),bodyStatus:status(a.description),time:Date.parse(a.date||'')}}
function compatible(a:ReturnType<typeof profile>,b:ReturnType<typeof profile>){return a.numbers===b.numbers&&a.status===b.status&&(!a.bodyNumbers||!b.bodyNumbers||a.bodyNumbers===b.bodyNumbers)&&(!a.body.size||!b.body.size||a.bodyStatus===b.bodyStatus)}
function rank(a:NewsItem){let official=false;try{official=/\.(gov|go\.kr|go\.jp)(\.|$)/.test(new URL(a.link).hostname)}catch{}return (official?10000:0)+Math.min(a.description.length,500)}
/** Conservative text similarity, not an AI confidence score. Unknown dates and changed facts remain separate. */
export function groupNews<T extends NewsItem>(input:T[],enabled=true,now=Date.now()){
 const sorted=[...input].sort((a,b)=>(Date.parse(b.date||'')||0)-(Date.parse(a.date||'')||0));
 if(!enabled)return {groups:sorted.map(article=>({article,related:[]} as NewsGroup<T>)),hidden:0};
 const urls=new Set<string>(),exact=new Map<string,T>(),groups:NewsGroup<T>[]=[],profiles:ReturnType<typeof profile>[]= [],index=new Map<string,Set<number>>();let hidden=0;
 for(const article of sorted){const url=canonicalNewsUrl(article.link),p=profile(article),key=titleKey(article)+'|'+p.status+'|'+p.numbers;
  const duplicate=exact.get(key);const sameTitle=duplicate&&compatible(p,profile(duplicate))&&Number.isFinite(p.time)&&Number.isFinite(Date.parse(duplicate.date||''))&&Math.abs(p.time-Date.parse(duplicate.date||''))<=WINDOW;
  if(urls.has(url)||(key.length>20&&sameTitle)){hidden++;continue}urls.add(url);exact.set(key,article);
  let matched=-1,nearDuplicate=false;
  if(Number.isFinite(p.time)&&now-p.time<=WINDOW&&p.time<=now+5*60*1000){const candidates=new Set<number>();for(const anchor of p.anchors)for(const i of index.get(anchor)||[])candidates.add(i);for(const i of candidates){const q=profiles[i];if(!Number.isFinite(q.time)||now-q.time>WINDOW||Math.abs(p.time-q.time)>WINDOW||!compatible(p,q))continue;
    const titleScore=dice(p.title,q.title),bodyScore=dice(p.body,q.body);
    if(!intersect(p.anchors,q.anchors)||!intersect(p.events,q.events))continue;
    const score=bodyScore?titleScore*.75+bodyScore*.25:titleScore;
    if(titleScore>=.9&&(!p.body.size&&!q.body.size||bodyScore>=.9)){matched=i;nearDuplicate=true;break}
    if(score>=.8||titleScore>=.8||(titleScore>=.65&&p.numbers&&p.numbers===q.numbers)){matched=i;break}
  }}
  if(matched<0){const i=groups.length;groups.push({article,related:[]});profiles.push(p);for(const anchor of p.anchors){if(!index.has(anchor))index.set(anchor,new Set());index.get(anchor)!.add(i)}}else if(nearDuplicate){hidden++}else{const g=groups[matched];if(rank(article)>rank(g.article)){g.related.push(g.article);g.article=article;/* Keep original cluster profile to prevent similarity chaining. */}else g.related.push(article)}
 }
 groups.sort((a,b)=>(Date.parse(b.article.date||'')||0)-(Date.parse(a.article.date||'')||0));return {groups,hidden};
}
