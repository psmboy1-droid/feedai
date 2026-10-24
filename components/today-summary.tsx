'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Menu,Plus,Sparkles,ArrowUpRight,Clock,Layers} from 'lucide-react';
import {useNewsAccount} from './news-account';
import NewsSidebar from './news-sidebar';
import TopMenu from './top-menu';
import FeedDirectory from './feed-directory';
import {navigateWorkspace} from '../lib/workspace-navigation';
import type {TodayBriefData} from '../lib/today-brief';
const pending=(status:string)=>['collecting','queued','in_progress'].includes(status);
const time=(value:string)=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
export default function TodaySummary(){
 const a=useNewsAccount(),[mobile,setMobile]=useState(false),[modal,setModal]=useState(false),[data,setData]=useState<TodayBriefData>({status:'idle'});
 const feedKey=useMemo(()=>JSON.stringify(a.feeds.map(f=>[f.id,f.url])),[a.feeds]);
 const generation=useRef(0),busy=useRef(false),controller=useRef<AbortController|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>{generation.current++;controller.current?.abort();if(timer.current)clearTimeout(timer.current);busy.current=false;setData({status:!a.feeds.length?'no_feeds':'idle'});return()=>{generation.current++;controller.current?.abort();if(timer.current)clearTimeout(timer.current)}},[a.ready,a.user?.id,a.status,feedKey]);
 async function analyze(){if(busy.current||!a.ready||!a.user||a.status==='계정에 저장 중…')return;if(a.status==='저장 실패'){setData({status:'failed',error:'구독 목록을 계정에 저장한 후 다시 시도해 주세요.'});return}busy.current=true;const seq=++generation.current;const abort=new AbortController();controller.current=abort;const active=()=>seq===generation.current&&!abort.signal.aborted;setData({status:'collecting'});
  async function request(method:string){const response=await fetch('/api/today',{method,headers:method==='POST'?{'Content-Type':'application/json'}:undefined,signal:abort.signal,cache:'no-store'});const body=await response.json() as TodayBriefData;if(!response.ok&&!body.status)body.status='failed';return body}
  let pollCount=0;async function poll(method:string){try{const next=await request(method);if(!active())return;setData(next);if(pending(next.status))timer.current=setTimeout(()=>void poll('GET'),Math.min(30000,5000*Math.pow(1.5,Math.min(pollCount++,5)))+Math.random()*2000);else busy.current=false}catch(e){if(active()){busy.current=false;setData({status:'failed',error:e instanceof Error?e.message:'요약을 불러오지 못했습니다.'})}}}
  await poll('POST');
 }

 function select(view:string,category='전체',source=''){const params=new URLSearchParams();if(view==='saved')params.set('view','saved');if(category!=='전체')params.set('category',category);if(source)params.set('source',source);navigateWorkspace('/my-feed'+(params.size?'?'+params.toString():''))}
 const result=data.result,snapshot=data.snapshot;
 if(!a.ready)return <div className="personal-gate" role="status">계정 확인 중…</div>;
 if(!a.user)return <div className="personal-gate"><h1>Today AI 요약</h1><p>로그인하면 내 구독 피드의 시장 브리핑을 볼 수 있습니다.</p><a href="/login?return_to=%2Ftoday" target="_top">가입 · 로그인</a></div>;
 return <div className="shell today-page"><NewsSidebar mobile={mobile} feeds={a.feeds} articleCount={a.articles.length} savedCount={a.saved.length} select={select} onAdd={()=>setModal(true)} onClose={()=>setMobile(false)} onDelete={id=>{a.setFeeds(fs=>fs.filter(f=>f.id!==id));a.setArticles(items=>items.filter(item=>item.feedId!==id))}}/><main><header className="topbar"><button className="mobile-toggle" onClick={()=>setMobile(!mobile)} aria-label="메뉴"><Menu/></button><TopMenu/><span className="private-badge">나의 시장 브리핑</span></header><div className="content"><div className="heading"><div><p className="eyebrow">MY FEEDS · MARKET BRIEFING</p><h1>Today AI 요약</h1><p className="subtitle">내 피드에서 주식시장에 중요한 소식만 모아 읽으세요.</p></div></div>
 <section className="today-info"><Sparkles size={22}/><div><b>최근 24시간 · 중요도 70 이상 · 한국·미국 시장</b><p>중요도는 뉴스의 시장 영향에 대한 AI 평가이며, 주가 상승 확률이 아닙니다. 제목과 RSS 요약을 기준으로 분석합니다.</p></div></section>
 {!pending(data.status)&&<div className="today-analysis-action"><button className="refresh" disabled={a.status==='계정에 저장 중…'||!a.feeds.length} onClick={()=>void analyze()}><Sparkles size={16}/> 분석 보기</button><p>버튼을 클릭했을 때만 AI 요약을 요청합니다. 저장된 최신 요약이 있으면 다시 보여줍니다.</p></div>}
 {data.createdAt&&<p className="today-time"><Clock size={14}/> 생성 기준 {time(data.createdAt)} · 한국시간 · 30분 캐시</p>}
 {(data.status==='loading'||data.status==='syncing'||pending(data.status))&&<section className="today-state" role="status"><Sparkles className="spin"/><h2>{data.status==='syncing'?'구독 목록을 계정에 저장하고 있습니다':data.status==='collecting'?'구독 피드의 기사를 모으고 있습니다':'주식시장에 중요한 뉴스를 선별·요약하고 있습니다'}</h2><p>요청이 많으면 대기열에서 순서대로 처리합니다. 완료한 요약은 계정에 저장됩니다. 생성 중 페이지를 나갔다면 다시 열어 상태를 확인하세요.</p></section>}
 {data.status==='no_feeds'&&<section className="today-state"><Layers size={30}/><h2>먼저 피드 소스를 선택해 주세요</h2><p>구독한 소스의 기사만 개인 AI 요약에 사용합니다.</p><button className="refresh" onClick={()=>setModal(true)}><Plus size={16}/> 피드 선택</button></section>}
 {data.status==='unconfigured'&&<section className="today-state"><h2>AI API 연결이 필요합니다</h2><p>관리자가 API를 연결하면 이 계정의 피드를 요약할 수 있습니다.</p>{a.user.admin&&<a href="/admin/ai" className="refresh">AI API 설정</a>}</section>}
 {data.status==='no_news'&&<section className="today-state"><h2>최근 24시간에 수집된 기사가 없습니다</h2><p>발행 시간을 확인할 수 있는 최근 기사로만 요약합니다.</p></section>}
 {data.error&&<p className="admin-error" role="alert">{data.error}</p>}
 {snapshot&&<div className="today-stats"><span>구독 소스 <b>{snapshot.feedCount}</b></span><span>최근 기사 <b>{snapshot.totalRecent}</b></span><span>검토 기사 <b>{snapshot.articles.length}</b></span><span>핵심 주제 <b>{result?.themes.length||0}</b></span></div>}
 {snapshot&&(snapshot.failedFeeds.length>0||snapshot.undated>0||snapshot.totalRecent>snapshot.articles.length)&&<details className="errors"><summary>수집 범위 안내</summary>{snapshot.failedFeeds.length>0&&<p>연결 실패 또는 수집 시간 제한으로 제외한 소스: {snapshot.failedFeeds.join(', ')}</p>}{snapshot.undated>0&&<p>발행 시간을 확인할 수 없는 기사 {snapshot.undated}개는 제외했습니다.</p>}{snapshot.totalRecent>snapshot.articles.length&&<p>최대 120개 후보를 검토합니다. 소스별 최신 기사를 먼저 포함한 뒤 최신순으로 채웁니다.</p>}</details>}
 {result&&data.status==='completed'&&<><section className="today-overview"><p className="eyebrow">AI MARKET OVERVIEW</p><h2>{result.headline}</h2><ul>{result.overview.map((line,i)=><li key={i}>{line}</li>)}</ul><div className="today-mood">{result.marketMood}</div></section>
 <h2 className="today-section-title">시장 영향이 큰 핵심 주제 <span>{result.themes.length}</span></h2>{!result.themes.length&&<p className="today-state">주식시장에 직접적인 영향을 줄 중요한 기사를 찾지 못했습니다.</p>}
 {result.themes.map((theme,index)=><article key={index} className="today-theme"><div className="today-theme-meta"><span>중요도 {theme.importance}</span><span>{theme.direction}</span><span>{theme.horizon}</span></div><h2>{theme.title}</h2><p><b>선별 이유</b> {theme.rationale}</p><p><b>시장 영향</b> {theme.impact}</p><p><b>관련 시장</b> {theme.markets.join(' · ')}</p>{theme.stocks.length>0&&<div className="today-stocks"><h3>관련 종목 후보</h3>{theme.stocks.map((stock,i)=><p key={i}><strong>{stock.name}</strong> {stock.ticker&&<span>({stock.ticker})</span>} · {stock.market}<br/>{stock.reason}</p>)}</div>}<div className="today-sources"><h3>근거 기사</h3>{theme.articleIds.map(id=>{const article=snapshot?.articles.find(a=>a.id===id);if(!article)return null;const href='/news?'+new URLSearchParams({title:article.title,summary:article.description,url:article.link,feedId:article.feedId}).toString();return <a key={id} href={href}>{article.title}<ArrowUpRight size={15}/><small>{article.source} · {time(article.date)}</small></a>})}</div></article>)}
 {result.watchpoints.length>0&&<section className="today-overview"><h2>다음으로 확인할 지표·이벤트</h2><ul>{result.watchpoints.map((point,i)=><li key={i}>{point}</li>)}</ul></section>}{result.excludedReason&&<p className="today-exclusions">선별 기준: {result.excludedReason}</p>}</>}
 <p className="today-disclaimer">AI 요약은 정보 참고용이며 투자 권유가 아닙니다. 기사 요약에는 누락이나 오류가 있을 수 있으므로 원문을 함께 확인하세요. 투자의 책임은 투자자 본인에게 있습니다.</p></div></main>{modal&&<FeedDirectory feeds={a.feeds} categories={a.categories} onAdd={feed=>a.setFeeds(old=>old.some(f=>f.url===feed.url)?old:[...old,feed])} onClose={()=>setModal(false)}/>}</div>;
}
