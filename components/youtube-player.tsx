'use client';
import {useEffect,useId,useState,type FormEvent} from 'react';
import {youtubeEmbed} from '../lib/youtube-embed';
type Video={id:string;src:string};
const storageKey='feedman-youtube-players';
const legacyKey='feedman-youtube-player';
function EmbedForm({initial='',onApply,onCancel}:{initial?:string;onApply:(src:string)=>void;onCancel?:()=>void}){
 const [input,setInput]=useState(initial),[error,setError]=useState('');const inputId=useId();
 function apply(event:FormEvent){event.preventDefault();try{onApply(youtubeEmbed(input));setError('')}catch(e){setError(e instanceof Error?e.message:'주소를 확인해 주세요.')}}
 return <form onSubmit={apply}><label htmlFor={inputId}>유튜브 주소 또는 임베드 소스코드</label><textarea id={inputId} value={input} onChange={e=>setInput(e.target.value)} placeholder="https://www.youtube.com/watch?v=…&#10;또는 &lt;iframe …&gt;&lt;/iframe&gt;" rows={3}/>{error&&<p role="alert" className="youtube-error">{error}</p>}<div className="youtube-actions">{onCancel&&<button type="button" onClick={onCancel}>취소</button>}<button className="youtube-apply" type="submit">{initial?'변경 적용':'영상 추가'}</button></div></form>;
}
function VideoPlayer({video,index,onChange,onRemove}:{video:Video;index:number;onChange:(src:string)=>void;onRemove:()=>void}){
 const [editing,setEditing]=useState(false);
 return <section className="youtube-video" aria-label={'유튜브 영상 '+(index+1)}>
  <div className="youtube-video-heading">영상 {index+1}</div>
  <div className="youtube-screen"><iframe src={video.src} title={'유튜브 라이브 및 동영상 '+(index+1)} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div>
  {editing?<EmbedForm initial={video.src} onApply={src=>{onChange(src);setEditing(false)}} onCancel={()=>setEditing(false)}/>:<div className="youtube-actions"><button type="button" onClick={()=>setEditing(true)}>소스 변경</button><button type="button" onClick={onRemove} aria-label={'영상 '+(index+1)+' 삭제'}>영상 삭제</button></div>}
 </section>;
}
export default function YoutubePlayer(){
 const [visible,setVisible]=useState(false);
 useEffect(()=>{const desktop=window.matchMedia('(min-width: 761px)');const sync=()=>setVisible(desktop.matches);sync();desktop.addEventListener('change',sync);return()=>desktop.removeEventListener('change',sync)},[]);
 const [videos,setVideos]=useState<Video[]>([]),[adding,setAdding]=useState(true),[collapsed,setCollapsed]=useState(true);
 useEffect(()=>{
  try{
   const saved=localStorage.getItem(storageKey);let restored:Video[]=[];
   if(saved!==null){
    const parsed:unknown=JSON.parse(saved);const ids=new Set<string>();
    if(Array.isArray(parsed))for(const item of parsed){try{if(typeof item?.id==='string'&&typeof item?.src==='string'&&!ids.has(item.id)){restored.push({id:item.id,src:youtubeEmbed(item.src)});ids.add(item.id)}}catch{}}
   }else{
    const legacy=localStorage.getItem(legacyKey);
    if(legacy){restored=[{id:crypto.randomUUID(),src:youtubeEmbed(legacy)}];localStorage.setItem(storageKey,JSON.stringify(restored));}
   }
   setVideos(restored);setAdding(restored.length===0);
  }catch{}
 },[]);
 function update(next:Video[]){setVideos(next);try{localStorage.setItem(storageKey,JSON.stringify(next))}catch{}}
 function add(src:string){update([...videos,{id:crypto.randomUUID(),src}]);setAdding(false)}
 function remove(id:string){const next=videos.filter(v=>v.id!==id);update(next);if(!next.length)setAdding(true)}
 if(!visible)return null;
 return <aside className={'youtube-panel'+(collapsed?' youtube-collapsed':'')} aria-label="고정 유튜브 플레이어">
  <div className="youtube-heading"><h2>유튜브 라이브 · 영상{videos.length>0&&<span className="youtube-count">{videos.length}</span>}</h2><div className="youtube-heading-actions"><button type="button" onClick={()=>{setAdding(true);setCollapsed(false)}}>+ 추가</button><button type="button" onClick={()=>setCollapsed(v=>!v)} aria-expanded={!collapsed} aria-controls="youtube-panel-body">{collapsed?'펼치기':'접기'}</button></div></div>
  <div id="youtube-panel-body" className="youtube-body">
   {adding&&<div className="youtube-add-form"><EmbedForm onApply={add} onCancel={videos.length?()=>setAdding(false):undefined}/></div>}
   {!videos.length&&<div className="youtube-screen"><div className="youtube-empty">YouTube<span>라이브나 동영상을 등록해 주세요</span></div></div>}
   {videos.map((video,index)=><VideoPlayer key={video.id} video={video} index={index} onChange={src=>update(videos.map(v=>v.id===video.id?{...v,src}:v))} onRemove={()=>remove(video.id)}/>)}
   <p className="youtube-hint">사이트 안에서 페이지를 이동해도 재생이 유지됩니다.</p>
  </div>
 </aside>;
}
