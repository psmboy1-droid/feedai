import {XMLParser} from 'fast-xml-parser';
export const DOPAMINE_HOUR=3600000;
export type VideoKind='shorts'|'video';
export type FeedVideo={videoId:string;title:string;channel:string;publishedAt:number;kind:VideoKind};
export type DopamineVideo=FeedVideo&{id:string;sourceId:string};
const list=(v:any):any[]=>v?Array.isArray(v)?v:[v]:[];
const string=(v:any):string=>typeof v==='string'?v:typeof v==='number'?String(v):v?.['#text']||'';
const plain=(v:any)=>string(v).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export function youtubeFeedUrl(raw:string){
 const url=new URL(raw.trim());if(url.protocol!=='https:'||url.username||url.password||url.port||!['youtube.com','www.youtube.com'].includes(url.hostname))throw Error('공식 YouTube RSS 주소 또는 /channel/UC… 주소를 입력해 주세요.');
 const channel=url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1]||(url.pathname==='/feeds/videos.xml'?url.searchParams.get('channel_id'):null);
 if(channel&&/^UC[A-Za-z0-9_-]{22}$/.test(channel))return 'https://www.youtube.com/feeds/videos.xml?channel_id='+channel;
 const playlist=['/feeds/videos.xml','/playlist'].includes(url.pathname)?url.searchParams.get(url.pathname==='/playlist'?'list':'playlist_id'):null;
 if(playlist&&/^[A-Za-z0-9_-]{10,100}$/.test(playlist))return 'https://www.youtube.com/feeds/videos.xml?playlist_id='+playlist;
 throw Error('RSS 주소의 channel_id 또는 playlist_id를 확인해 주세요. @계정 주소 대신 채널 ID가 포함된 RSS 주소를 사용해 주세요.');
}
export function parseYoutubeFeed(xml:string):FeedVideo[]{
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('지원하지 않는 XML 형식입니다.');
 const doc=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',processEntities:true}).parse(xml);
 if(!doc.feed)throw Error('YouTube Atom 피드 형식이 아닙니다.');
 const channel=plain(doc.feed.author?.name||doc.feed.title).slice(0,200),seen=new Set<string>();
 return list(doc.feed.entry).slice(0,60).flatMap(entry=>{
  const links=list(entry.link),link=string(links.find(l=>l['@_rel']==='alternate')?.['@_href']||links[0]?.['@_href']);
  const videoId=string(entry['yt:videoId']);const title=plain(entry.title).slice(0,1000),publishedAt=Date.parse(string(entry.published));
  if(!/^[A-Za-z0-9_-]{11}$/.test(videoId)||!title||!Number.isFinite(publishedAt)||publishedAt>Date.now()+600000||seen.has(videoId))return [];
  seen.add(videoId);let shorts=false;try{const u=new URL(link);shorts=['www.youtube.com','youtube.com'].includes(u.hostname)&&u.pathname==='/shorts/'+videoId}catch{}
  return [{videoId,title,channel:plain(entry.author?.name).slice(0,200)||channel,publishedAt,kind:(shorts||/(?:^|\s)#(?:shorts|쇼츠)(?:\s|$|[.,!])/iu.test(title)?'shorts':'video') as VideoKind}];
 });
}
export async function fetchYoutubeFeed(raw:string):Promise<FeedVideo[]>{
 const url=youtubeFeedUrl(raw);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const r=await fetch(url,{headers:{Accept:'application/atom+xml, application/xml','User-Agent':'Feedman YouTube RSS'},redirect:'manual',signal:controller.signal});if(!r.ok)throw Error('YouTube 피드 응답 오류 ('+r.status+'). 주소를 확인해 주세요.');
 const reader=r.body?.getReader();if(!reader)throw Error('빈 피드 응답입니다.');const decoder=new TextDecoder();let xml='',bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1500000){await reader.cancel();throw Error('피드 용량이 너무 큽니다.')}xml+=decoder.decode(value,{stream:true})}xml+=decoder.decode();return parseYoutubeFeed(xml);
 }finally{clearTimeout(timer)}
}
export function alternatingVideoRows(items:DopamineVideo[],cycles:number){const shorts=items.filter(v=>v.kind==='shorts'),videos=items.filter(v=>v.kind==='video');const rows:{kind:VideoKind;items:DopamineVideo[]}[]=[];for(let i=0;i<Math.min(cycles,Math.ceil(Math.max(shorts.length,videos.length)/3));i++){rows.push({kind:'shorts',items:shorts.slice(i*3,i*3+3)},{kind:'video',items:videos.slice(i*3,i*3+3)})}return rows}
