type Monitor={addEventListener:(event:string,handler:(event:{loaded:number})=>void)=>void};
type Translator={translate:(text:string)=>Promise<string>};
type Detector={detect:(text:string)=>Promise<{detectedLanguage:string;confidence:number}[]>};
type APIs={Translator?:{availability:(options:{sourceLanguage:string;targetLanguage:string})=>Promise<string>;create:(options:{sourceLanguage:string;targetLanguage:string;monitor?:(monitor:Monitor)=>void})=>Promise<Translator>};LanguageDetector?:{availability:()=>Promise<string>;create:(options?:{monitor?:(monitor:Monitor)=>void})=>Promise<Detector>}};
export class TranslationPackNeeded extends Error{constructor(public language:string){super('번역 언어팩 준비가 필요합니다.')}}
export class TranslationUnsupported extends Error{constructor(public language:string){super('이 언어는 브라우저 번역을 지원하지 않습니다.')}}
export function normalizeLanguage(language:string){if(/^zh-(hant|tw|hk)/i.test(language))return 'zh-Hant';return language.toLowerCase().split('-')[0]}
export function looksKorean(text:string){const hangul=(text.match(/[가-힣]/g)||[]).length;const letters=(text.match(new RegExp('\\p{L}','gu'))||[]).length;return hangul>0&&hangul>=letters*.45&&!/[\u3040-\u30ff\u0600-\u06ff\u0400-\u04ff]/.test(text)}
export class BrowserTranslation {
 private detector:Promise<Detector>|null=null;
 private translators=new Map<string,Promise<Translator>>();
 private detected=new Map<string,string>();
 private unsupported=new Set<string>();
 private api(){return globalThis as typeof globalThis&APIs}
 supported(){return !!this.api().Translator&&!!this.api().LanguageDetector}
 async detectorAvailability(){if(this.detector)return 'available';return this.api().LanguageDetector?.availability()||'unavailable'}
 async initialize(progress?:(percent:number)=>void){
  if(!this.supported())throw Error('언어 감지와 번역을 지원하는 데스크톱 Chrome이 필요합니다.');
  if(!this.detector){this.detector=this.api().LanguageDetector!.create({monitor:m=>m.addEventListener('downloadprogress',e=>progress?.(Math.round(e.loaded*100)))});this.detector.catch(()=>{this.detector=null})}
  await this.detector;
 }
 async language(text:string,context=''){
  if(!text.trim()||!new RegExp('\\p{L}','u').test(text))return 'und';
  if(looksKorean(text))return 'ko';
  const key=text.slice(0,2000)+'\n'+context.slice(0,1000);const cached=this.detected.get(key);if(cached)return cached;
  if(!this.detector)throw new TranslationPackNeeded('detector');
  const detector=await this.detector;let results=await detector.detect(text.slice(0,4000));let best=results[0];
  if((!best||best.confidence<.4||best.detectedLanguage==='und')&&context)best=(await detector.detect(context.slice(0,4000)))[0];
  const language=best&&best.confidence>=.4?normalizeLanguage(best.detectedLanguage):/[\u3040-\u30ff]/.test(text)?'ja':'und';
  if(this.detected.size>=2000)this.detected.delete(this.detected.keys().next().value!);this.detected.set(key,language);return language;
 }
 async prepare(language:string,progress?:(percent:number)=>void){
  if(language==='ko'||language==='und')return;
  if(this.translators.has(language)){await this.translators.get(language);return}
  if(this.unsupported.has(language))throw new TranslationUnsupported(language);
  const factory=this.api().Translator;if(!factory)throw new TranslationUnsupported(language);
  const options={sourceLanguage:language,targetLanguage:'ko'};
  if(await factory.availability(options)==='unavailable'){this.unsupported.add(language);throw new TranslationUnsupported(language)}
  const translator=factory.create({...options,monitor:m=>m.addEventListener('downloadprogress',e=>progress?.(Math.round(e.loaded*100)))});
  this.translators.set(language,translator);
  try{await translator}catch{this.translators.delete(language);throw new TranslationPackNeeded(language)}
 }
 async translate(text:string,context=''){
  if(!text.trim())return text;const language=await this.language(text,context);if(language==='ko'||language==='und')return text;
  await this.prepare(language);return (await this.translators.get(language)!).translate(text);
 }
}
export const browserTranslation=new BrowserTranslation();
