'use client';
import {useEffect,useMemo,useState} from 'react';
import type {ArticleContent as Content,ArticleImage} from '../lib/article-content';
import {useNewsTranslation} from '../hooks/use-news-translation';
function ArticlePhoto({image}:{image:ArticleImage}){const [failed,setFailed]=useState(false);if(failed)return <figure className="article-photo"><figcaption>이미지를 불러오지 못했습니다. 원본 파일의 접근 상태를 확인해 주세요.</figcaption></figure>;return <figure className="article-photo"><img src={image.url} alt={image.alt||'기사 사진'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>{image.alt&&<figcaption>{image.alt}</figcaption>}</figure>}
export default function ArticleContent({url,feedUrl,summary,ready}:{url:string;feedUrl?:string;summary:string;ready:boolean}){
 const [content,setContent]=useState<Content|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  if(!ready||!url)return;const controller=new AbortController();setContent(null);setError('');setLoading(true);
  const params=new URLSearchParams({url,extraction:"3"});if(feedUrl)params.set('feedUrl',feedUrl);
  fetch('/api/article?'+params,{signal:controller.signal}).then(async r=>{const d=await r.json() as Content&{error?:string};if(!r.ok)throw Error(d.error||'기사 본문을 가져오지 못했습니다.');if(!controller.signal.aborted)setContent(d)}).catch(e=>{if(!controller.signal.aborted)setError(e.message||'기사 본문을 가져오지 못했습니다.')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[url,feedUrl,ready]);
 const items=useMemo(()=>content?.paragraphs.map((text,index)=>({link:url+'#article-paragraph-'+index,title:text,description:''}))||[],[content,url]);const translation=useNewsTranslation(items);
 return <section className="article-content" aria-label="기사 본문" aria-busy={!ready||loading}>
  <div className="article-content-heading"><h2>{content?.kind==='social'?'게시물 본문 · 이미지 · 영상':'기사 본문 · 사진'}</h2>{content&&<div>{translation.needsActivation&&<button type="button" onClick={translation.start}>새 언어팩 준비</button>}{translation.status==='ready'?<button type="button" onClick={translation.toggle}>{translation.enabled?'원문 보기':'한국어 보기'}</button>:translation.status==='needs-activation'?<button type="button" onClick={translation.start}>본문 자동 번역 켜기</button>:null}</div>}</div>
  {(!ready||loading)&&<p className="article-content-status" role="status">RSS와 원문에서 기사 내용·사진을 불러오는 중…</p>}
  {error&&<><p className="article-content-status" role="status">{error} 아래 원문 바로가기에서 확인해 주세요.</p>{summary&&<p className="article-fallback-summary">{summary}</p>}</>}
  {content&&<>
   <p className="article-content-source">{content.kind==='social'?'SNS 공개 페이지에서 수집한 내용':content.kind==='rss'?'RSS에서 제공한 내용':'원문에서 추출한 내용'}{translation.pending>0?' · 한국어로 번역 중…':''}</p>
   {translation.notice&&<p className="article-content-status">{translation.notice}</p>}{content.notice&&<p className="article-content-status">{content.notice}</p>}
   {content.images[0]&&<ArticlePhoto key={content.images[0].url} image={content.images[0]}/>}
   <div className="article-full-text">{content.paragraphs.map((text,index)=>{const translated=translation.translations[url+'#article-paragraph-'+index];return <p key={index}>{translation.enabled&&translated?.originalTitle===text?translated.title:text}</p>})}</div>
   {content.media?.map((media,index)=><div key={index}>{media.url?(media.kind==='video'?<video controls preload="metadata" playsInline src={media.url} style={{width:'100%',maxHeight:'75vh'}}/>:<ArticlePhoto image={{url:media.url,alt:'게시물 이미지 '+(index+1)}}/>):<p className="article-content-status">{media.error||'미디어 수집 실패'}</p>}</div>)}
   {content.images.slice(1).map(image=><ArticlePhoto key={image.url} image={image}/>)}
   {content.truncated&&<p className="article-content-status">내용이 길어 일부만 표시했습니다. 전체 내용은 원문에서 확인해 주세요.</p>}
   <p className="article-content-source">출처: <a href={content.sourceUrl} target="_blank" rel="noopener noreferrer">{new URL(content.sourceUrl).hostname}</a> · 원문과 함께 확인해 주세요.</p>
  </>}
 </section>;
}
