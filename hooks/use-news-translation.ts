'use client';
import {useEffect,useRef,useState} from 'react';
import {browserTranslation,TranslationPackNeeded,TranslationUnsupported} from '../lib/browser-translation';
type Item={title:string;description:string;link:string};
type Result={title:string;description:string;originalTitle:string;originalDescription:string};
export function useNewsTranslation(items:Item[]){
 const [translations,setTranslations]=useState<Record<string,Result>>({}),[enabled,setEnabled]=useState(true),[status,setStatus]=useState('checking'),[notice,setNotice]=useState(''),[progress,setProgress]=useState(0),[pending,setPending]=useState(0),[needsActivation,setNeedsActivation]=useState(false),[revision,setRevision]=useState(0);
 const cache=useRef<Record<string,Result>>({}),creating=useRef(false),skipped=useRef(new Set<string>()),needed=useRef(new Set<string>()),currentItems=useRef(items);currentItems.current=items;
 const signature=(a:Item)=>a.link+'\n'+a.title+'\n'+a.description;
 function save(){try{localStorage.setItem('nd-translations',JSON.stringify(Object.fromEntries(Object.entries(cache.current).slice(-1000))))}catch{}}
 async function start(){
  if(creating.current)return;if(!browserTranslation.supported()){setStatus('unsupported');setNotice('다국어 자동 번역은 언어 감지·번역을 지원하는 데스크톱 Chrome에서 사용할 수 있습니다.');return}
  creating.current=true;setStatus('downloading');setProgress(0);setNotice('언어 감지와 번역에 필요한 언어팩을 준비합니다.');
  try{
   await browserTranslation.initialize(setProgress);
   const languages=new Set(needed.current);
   // Detect all current article languages, including a summary in a different language.
   for(const a of currentItems.current){const context=a.title+' '+a.description;languages.add(await browserTranslation.language(a.title,context));if(a.description)languages.add(await browserTranslation.language(a.description,context))}
   let stillNeeded=false,unsupported=false;
   await Promise.all([...languages].filter(l=>l!=='detector').map(async language=>{try{await browserTranslation.prepare(language,setProgress);needed.current.delete(language)}catch(e){if(e instanceof TranslationPackNeeded){needed.current.add(language);stillNeeded=true}else unsupported=true}}));
   setNeedsActivation(stillNeeded);setStatus('ready');setNotice(stillNeeded?'새 언어팩 준비를 눌러 번역을 이어가세요.':unsupported?'지원하지 않는 언어는 원문으로 표시합니다.':'');setEnabled(true);setRevision(n=>n+1);try{localStorage.setItem('nd-translate','on')}catch{}
  }catch{setStatus('needs-activation');setNotice('자동 번역 켜기를 눌러 언어 감지·번역 모델을 준비해 주세요.')}finally{creating.current=false}
 }
 useEffect(()=>{
  let live=true;try{const stored=JSON.parse(localStorage.getItem('nd-translations')||'{}');for(const [key,value] of Object.entries(stored)){const r=value as Result;if(r&&['title','description','originalTitle','originalDescription'].every(k=>typeof r[k as keyof Result]==='string'))cache.current[key]=r}setTranslations(cache.current);setEnabled(localStorage.getItem('nd-translate')!=='off')}catch{}
  if(!browserTranslation.supported()){setStatus('unsupported');setNotice('다국어 자동 번역은 언어 감지·번역을 지원하는 데스크톱 Chrome에서 사용할 수 있습니다.');return}
  browserTranslation.detectorAvailability().then(async availability=>{if(!live)return;if(availability==='available'){try{await browserTranslation.initialize();if(live)setStatus('ready')}catch{if(live)setStatus('needs-activation')}}else if(availability==='unavailable'){setStatus('unsupported');setNotice('이 브라우저 또는 기기에서는 언어 자동 감지를 지원하지 않습니다.')}else{setStatus('needs-activation');setNotice('자동 번역 켜기를 누르면 언어 감지·번역에 필요한 모델을 준비합니다.')}}).catch(()=>{if(live)setStatus('needs-activation')});
  return()=>{live=false};
 },[]);
 useEffect(()=>{
  if(status!=='ready'||!enabled)return;let cancelled=false;
  const queue=items.filter(a=>!skipped.current.has(signature(a))&&(!cache.current[a.link]||cache.current[a.link].originalTitle!==a.title||cache.current[a.link].originalDescription!==a.description));setPending(queue.length);
  (async()=>{for(const a of queue){if(cancelled)break;try{
   const context=a.title+' '+a.description;const title=await browserTranslation.translate(a.title,context);const description=await browserTranslation.translate(a.description,context);if(cancelled)break;
   if(title!==a.title||description!==a.description){cache.current[a.link]={title,description,originalTitle:a.title,originalDescription:a.description};setTranslations({...cache.current});save()}else skipped.current.add(signature(a));
  }catch(e){if(cancelled)break;if(e instanceof TranslationPackNeeded){needed.current.add(e.language);setNeedsActivation(true);setNotice('새 언어팩 준비를 눌러 번역을 이어가세요.')}else if(e instanceof TranslationUnsupported){skipped.current.add(signature(a));setNotice('브라우저에서 지원하지 않는 언어는 원문으로 표시합니다.')}else{skipped.current.add(signature(a));setNotice('일부 내용을 번역하지 못해 원문으로 표시합니다.')}}if(!cancelled)setPending(n=>Math.max(0,n-1))}if(!cancelled)setPending(0)})();
  return()=>{cancelled=true};
 },[items,status,enabled,revision]);
 function toggle(){setEnabled(v=>{try{localStorage.setItem('nd-translate',v?'off':'on')}catch{}return !v})}
 return {translations,enabled,status,notice,progress,pending,start,toggle,needsActivation};
}
