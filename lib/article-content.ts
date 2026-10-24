import {cleanArticleHtml,selectArticleRegion} from './article-html';
import {XMLParser} from 'fast-xml-parser';
import {publicArticleUrl} from './article-excerpt';
export type ArticleImage={url:string;alt:string};
export type ArticleContent={paragraphs:string[];images:ArticleImage[];sourceUrl:string;kind:'rss'|'original'|'social';truncated:boolean;media?:{kind:'image'|'video';url:string;error:string}[];notice?:string};
const maxText=100000;
const list=(v:any):any[]=>v==null?[]:Array.isArray(v)?v:[v];
const value=(v:any):string=>typeof v==='string'?v:typeof v==='number'?String(v):Array.isArray(v)?v.map(value).join('\n'):v&&typeof v==='object'?Object.entries(v).filter(([k])=>!k.startsWith('@_')).map(([,x])=>value(x)).join('\n'):'';
export function decodeEntities(s:string){return s.replace(/&#(?:x([\da-f]+)|(\d+));/gi,(_,hex,dec)=>{const n=parseInt(hex||dec,hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):''}).replace(/&(nbsp|amp|quot|apos|lt|gt|rsquo|lsquo|rdquo|ldquo|mdash|ndash);/gi,(_,k)=>({nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',mdash:'—',ndash:'–'}[k.toLowerCase() as string]||''))}
export function articleText(html:string){return decodeEntities(html.replace(/<(script|style|noscript|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/blockquote|\/section)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ')).split(/\n+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean)}
function attrs(tag:string){const out:Record<string,string>={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))out[m[1].toLowerCase()]=decodeEntities(m[2]??m[3]??m[4]);return out}
function imageUrl(raw:string,base:string){try{return publicArticleUrl(new URL(raw,base).href).href}catch{return ''}}
function imagesFromHtml(html:string,base:string){const images:ArticleImage[]=[];for(const tag of html.matchAll(/<img\b[^>]*>/gi)){const a=attrs(tag[0]);if(a.width==='1'||a.height==='1'||(Number(a.width)>0&&Number(a.height)>0&&Number(a.width)<=100&&Number(a.height)<=100))continue;const raw=a['data-src']||a['data-original']||a.src||a.srcset?.split(',')[0].trim().split(/\s+/)[0]||'';const url=imageUrl(raw,base);if(url&&!/\b(?:logo|icon|avatar|tracking|pixel|spinner|placeholder)\b/i.test(new URL(url).pathname+' '+(a.alt||'')))images.push({url,alt:a.alt||''})}return images}
function imageKey(raw:string){
 try{const u=new URL(raw);u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid|w|h|width|height|q|quality|fit|crop|resize|format|fm|auto|dpr)$/i.test(k))u.searchParams.delete(k);u.pathname=u.pathname.replace(/^\/cdn-cgi\/image\/[^/]+\//i,'/').replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]{2,5}$)/i,'');u.searchParams.sort();return u.href}catch{return raw}
}
export function deduplicateArticleImages(images:ArticleImage[]){const seen=new Set<string>();return images.filter(i=>{const key=imageKey(i.url);if(!i.url||seen.has(key)||/\b(?:logo|icon|avatar|tracking|pixel|spinner|placeholder)\b/i.test(new URL(i.url).pathname))return false;seen.add(key);return true})}
export function selectArticleImages(...sources:ArticleImage[][]){
 for(const source of sources){const images=deduplicateArticleImages(source);if(images.length)return images.slice(0,30)}
 return [];
}
function result(paragraphs:string[],images:ArticleImage[],sourceUrl:string,kind:'rss'|'original'|'social'):ArticleContent{
 let length=0,truncated=false;const body:string[]=[],seenText=new Set<string>();
 for(const raw of paragraphs){const p=raw.replace(/\s+/g,' ').trim();const key=p.normalize('NFC');if(/^(?:광고|관련\s?기사|구독|Advertisement|Subscribe)$/i.test(p))continue;if(!p||seenText.has(key)||/^(subscribe|sign up|all rights reserved|advertisement|copyright|read more|related articles|you may also like|무단전재)(?:\s|$|[:：])/i.test(p))continue;seenText.add(key);if(length>=maxText){truncated=true;break}body.push(p.slice(0,maxText-length));if(p.length>maxText-length)truncated=true;length+=p.length}
 const unique=deduplicateArticleImages(images);
 return {paragraphs:body,images:unique.slice(0,30),sourceUrl,kind,truncated:truncated||unique.length>30};
}
function normalized(raw:string){try{const u=new URL(raw);if(['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(u.hostname)){const id=u.pathname.match(/\/status\/(\d+)(?:\/|$)/)?.[1];if(id)return 'https://x.com/i/status/'+id}u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href}catch{return raw}}
export function extractRssContent(xml:string,feedUrl:string,articleUrl:string):ArticleContent|null{
 const doc=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',textNodeName:'#text'}).parse(xml);
 const root=doc.rss?.channel||doc.feed||doc['rdf:RDF'];if(!root)return null;
 for(const item of list(root.item||root.entry||doc['rdf:RDF']?.item)){
  const links=list(item.link);const raw=value(links.find(l=>l?.['@_rel']==='alternate')?.['@_href']||links.find(l=>l?.['@_href'])?.['@_href']||item.link||item.guid);
  let link='';try{link=new URL(raw,feedUrl).href}catch{}if(normalized(link)!==normalized(articleUrl))continue;
  const candidates=[item['content:encoded'],item.content,item.description,item.summary].map(value).filter(Boolean).map(cleanArticleHtml);
  const chosen=candidates.sort((a,b)=>articleText(b).join('').length-articleText(a).join('').length)[0]||'';const paragraphs=articleText(chosen);
  const bodyImages=candidates.flatMap(html=>imagesFromHtml(html,link)),mediaImages:ArticleImage[]=[],thumbnails:ArticleImage[]=[];
  for(const m of [...list(item.enclosure),...list(item['media:content']),...list(item['media:group']?.['media:content'])]){
   if(m?.['@_type']&&!m['@_type'].startsWith('image/')&&m['@_medium']!=='image')continue;
   const raw=m?.['@_url'];if(typeof raw==='string'){const url=imageUrl(raw,link);if(url)mediaImages.push({url,alt:value(item.title)})}
  }
  for(const m of [...list(item['media:thumbnail']),...list(item['media:group']?.['media:thumbnail'])]){const raw=m?.['@_url'];if(typeof raw==='string'){const url=imageUrl(raw,link);if(url)thumbnails.push({url,alt:value(item.title)})}}
  return result(paragraphs,bodyImages.length||mediaImages.length?[...bodyImages,...mediaImages]:thumbnails,link,'rss');
 }
 return null;
}
function structuredArticle(data:any,depth=0):any{
 if(!data||depth>12)return null;if(Array.isArray(data)){for(const item of data){const found=structuredArticle(item,depth+1);if(found)return found}}else if(typeof data==='object'){
  if(typeof data.articleBody==='string'&&data.articleBody.trim().length>=80)return data;
  for(const key of ['@graph','mainEntity','hasPart','itemListElement']){const found=structuredArticle(data[key],depth+1);if(found)return found}
 }return null;
}
export function extractOriginalContent(html:string,url:string):ArticleContent{
 const region=selectArticleRegion(cleanArticleHtml(html));
 const paragraphs=[...region.matchAll(/<(p|h[2-6]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)].flatMap(m=>articleText(m[2])).filter(t=>t.length>=2);
 let structured:any=null;
 for(const tag of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{structured=structuredArticle(JSON.parse(tag[1]));if(structured)break}catch{}}
 const body=structured?articleText(cleanArticleHtml(structured.articleBody)):paragraphs;
 const bodyImages=imagesFromHtml(region,url),structuredImages:ArticleImage[]=[],metaImages:ArticleImage[]=[];
 if(structured)for(const item of list(structured.image)){const raw=typeof item==='string'?item:item?.url||item?.contentUrl;if(typeof raw==='string'){const src=imageUrl(raw,url);if(src)structuredImages.push({url:src,alt:String(structured.headline||'기사 사진')})}}
 for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){const a=attrs(tag[0]);if(['og:image','twitter:image'].includes(a.property||a.name)){const src=imageUrl(a.content||'',url);if(src)metaImages.push({url:src,alt:'기사 대표 사진'})}}
 if(!body.length)throw Error('기사 본문을 추출하지 못했습니다. 요약과 원문 링크로 확인해 주세요.');
 return result(body,selectArticleImages(bodyImages,structuredImages,metaImages.slice(0,1)),url,'original');
}
