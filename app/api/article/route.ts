import {socialAccount} from '../../../lib/social-parser';
import {getChatGPTUser} from '../../chatgpt-auth';
import {socialPostForUser,publicSocialContent,hasStoredSocialPost} from '../../../lib/social-service';
import {publicArticleUrl} from '../../../lib/article-excerpt';
import {extractOriginalContent,extractRssContent,selectArticleImages,type ArticleContent} from '../../../lib/article-content';
const cache=new Map<string,{expires:number;result:ArticleContent}>();
async function readPublic(raw:string,accept:string,timeout:number){
 let url=publicArticleUrl(raw);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
 try{
  let res:Response|undefined;
  for(let i=0;i<5;i++){
   res=await fetch(url,{headers:{Accept:accept,'User-Agent':'Feedman Article Reader'},redirect:'manual',signal:controller.signal});
   if(res.status>=300&&res.status<400){const next=res.headers.get('location');if(!next)throw Error('원문 이동 주소가 없습니다.');url=publicArticleUrl(new URL(next,url).href);continue}break;
  }
  if(!res?.ok)throw Error(res?.status===403||res?.status===429?'매체에서 원문 접근을 제한하고 있습니다.':'원문 응답 오류 ('+res?.status+').');
  if(accept==='text/html'&&!res.headers.get('content-type')?.includes('text/html'))throw Error('원문이 HTML 형식이 아닙니다.');
  const reader=res.body?.getReader();if(!reader)throw Error('원문 내용이 없습니다.');const decoder=new TextDecoder();let text='',bytes=0;
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>3000000){await reader.cancel();throw Error('원문 용량이 너무 큽니다.')}text+=decoder.decode(value,{stream:true})}
  return {text:text+decoder.decode(),url:url.href};
 }finally{clearTimeout(timer)}
}
export async function GET(req:Request){
 try{
  const params=new URL(req.url).searchParams;const articleUrl=publicArticleUrl(params.get('url')||'').href;
  const feedUrl=params.get('feedUrl')?publicArticleUrl(params.get('feedUrl')!).href:'';
  let nativeFeed=false;try{nativeFeed=Boolean(feedUrl&&socialAccount(feedUrl))}catch{}
  const socialLink=['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com','instagram.com','www.instagram.com'].includes(new URL(articleUrl).hostname);
  // A public X link inside ordinary RSS is not a native SNS subscription.
  if(nativeFeed||(!feedUrl&&socialLink&&await hasStoredSocialPost(articleUrl))){const user=await getChatGPTUser();if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});return Response.json(publicSocialContent(await socialPostForUser(articleUrl,user.userId)),{headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}})}
  const key='clean-v4\n'+articleUrl+'\n'+feedUrl;
  const hit=cache.get(key);if(hit&&hit.expires>Date.now())return Response.json(hit.result,{headers:{'Cache-Control':'public, max-age=300'}});
  let rss:ArticleContent|null=null;
  if(feedUrl)try{const feed=await readPublic(feedUrl,'application/rss+xml, application/atom+xml, application/xml, text/xml',8000);rss=extractRssContent(feed.text,feed.url,articleUrl)}catch{}
  let result:ArticleContent;
  if(rss&&(rss.paragraphs.join('').length>=1000||socialLink&&(rss.paragraphs.length>0||rss.images.length>0))){
   result=rss;
   if(!rss.images.length&&!socialLink)try{const original=await readPublic(articleUrl,'text/html',14000);result={...rss,images:extractOriginalContent(original.text,original.url).images}}catch{}
  }
  else{
   try{
    const original=await readPublic(articleUrl,'text/html',14000);result=extractOriginalContent(original.text,original.url);
    result.images=selectArticleImages(result.images,rss?.images||[])
   }catch(e){
    if(!rss?.paragraphs.length)throw e;
    result={...rss,notice:'원문에서 추가 본문을 가져오지 못해 RSS가 제공한 내용을 표시합니다.'};
   }
  }
  if(cache.size>=80)cache.delete(cache.keys().next().value!);cache.set(key,{expires:Date.now()+3600000,result});
  return Response.json(result,{headers:{'Cache-Control':'public, max-age=300'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'본문을 불러오지 못했습니다.'},{status:422,headers:{'Cache-Control':'no-store'}})}
}
