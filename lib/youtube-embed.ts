/** Extract only a YouTube URL; never render pasted HTML. */
export function youtubeEmbed(input:string):string {
 let value=input.trim();
 if(value.startsWith('<')){
  const match=value.match(/<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i);
  if(!match)throw Error('유튜브 iframe 소스코드 또는 영상 주소를 입력해 주세요.');
  value=match[2].replace(/&amp;/g,'&');
 }
 if(/^(www\.)?(youtube\.com|youtu\.be)\//i.test(value))value='https://'+value;
 let url:URL;try{url=new URL(value)}catch{throw Error('올바른 유튜브 주소를 입력해 주세요.')}
 const host=url.hostname.toLowerCase();
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port||!['youtube.com','www.youtube.com','m.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com','youtu.be'].includes(host))throw Error('유튜브 영상·라이브 주소만 등록할 수 있습니다.');
 const parts=url.pathname.split('/').filter(Boolean);
 let id=host==='youtu.be'?parts[0]:parts[0]==='watch'?url.searchParams.get('v'):['embed','live','shorts'].includes(parts[0])?parts[1]:null;
 let path='';
 if(id==='live_stream'&&parts[0]==='embed'){
  const channel=url.searchParams.get('channel');
  if(!channel||!/^UC[A-Za-z0-9_-]{22}$/.test(channel))throw Error('올바른 유튜브 라이브 채널 주소가 필요합니다.');
  path='live_stream?channel='+channel+'&';
 }else{
  if(!id||!/^[A-Za-z0-9_-]{11}$/.test(id))throw Error('영상의 공유 주소 또는 iframe 소스코드를 입력해 주세요.');
  path=id+'?';
 }
 const params=new URLSearchParams({autoplay:'1',playsinline:'1',rel:'0'});
 const start=url.searchParams.get('start')||url.searchParams.get('t');
 if(start&&/^\d{1,6}s?$/.test(start))params.set('start',start.replace(/s$/,''));
 return 'https://www.youtube.com/embed/'+path+params;
}
