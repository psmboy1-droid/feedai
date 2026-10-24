'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {Menu} from 'lucide-react';
import NewsSidebar from './news-sidebar';
import FeedDirectory from './feed-directory';
import DopamineCenter from './dopamine-center';
import DopamineAdmin from './dopamine-admin';
import FeedPage from '../app/page';
import TodaySummary from './today-summary';
import NewsPage from '../app/news/page';
import RssAdmin from './rss-admin';
import AiSettings from './ai-settings';
import SeoSettings from './seo-settings';
import PromptSettings from './prompt-settings';
import MemberAdmin from './member-admin';
import AdminHome from './admin-home';
import {useNewsAccount} from './news-account';
import YoutubePlayer from './youtube-player';
import MyPage from './my-page';
import BillingPage from './billing-page';
import BillingAdmin from './billing-admin';
import {navigateWorkspace,workspaceNavigationEvent} from '../lib/workspace-navigation';

// 💡 1. 뚫어놓은 /login 경로를 정식 허용 루트에 추가!
const routes=new Set(['/','/my-feed','/today','/news','/admin','/admin/rss','/admin/ai','/admin/seo','/admin/prompts','/admin/members','/dopamine','/admin/dopamine','/mypage','/billing','/admin/billing', '/login']);

export default function WorkspaceShell({children}:{children:ReactNode}){
 const [route,setRoute]=useState<string|null>(null);
 const account=useNewsAccount();
 const [sidebarOpen,setSidebarOpen]=useState(false),[directoryOpen,setDirectoryOpen]=useState(false);
 const pathname=usePathname()||'/';
 const activePath=route?.split('?')[0]||pathname;
 const isAdmin=activePath==='/admin'||activePath.startsWith('/admin/');
 const showYoutubePlayer=!isAdmin&&activePath!=='/dopamine'&&activePath!=='/login';
 
 // 💡 2. 로그인 화면(/login)일 때는 거추장스러운 사이드바를 치우고 전체화면으로 띄움!
 const pageHasSidebar=activePath==='/login'||activePath==='/news'||((activePath==='/'||activePath==='/my-feed')&&account.ready&&(activePath!=='/my-feed'||!!account.user))||(activePath==='/today'&&account.ready&&!!account.user);
 
 useEffect(()=>setSidebarOpen(false),[activePath]);
 function selectSidebar(view:string,category='전체',source=''){const params=new URLSearchParams();if(view==='saved')params.set('view','saved');if(category!=='전체')params.set('category',category);if(source)params.set('source',source);setSidebarOpen(false);navigateWorkspace((account.user?'/my-feed':'/')+(params.size?'?'+params.toString():''))}
 useEffect(()=>{
  function move(href:string,push=true){
   const url=new URL(href,window.location.href);
   if(url.origin!==window.location.origin||!routes.has(url.pathname))return false;
   if(push)window.history.pushState(null,'',url.pathname+url.search+url.hash);
   setRoute(url.pathname+url.search);window.scrollTo(0,0);return true;
  }
  function click(event:MouseEvent){
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const target=event.target instanceof Element?event.target.closest('a'):null;
   if(!target||target.hasAttribute('download')||(target.target&&target.target!=='_self'))return;
   const url=new URL(target.href,window.location.href);
   if(url.hash||url.origin!==window.location.origin||!routes.has(url.pathname))return;
   if(move(url.href))event.preventDefault();
  }
  function requested(event:Event){const href=(event as CustomEvent).detail;if(typeof href==='string'&&move(href))event.preventDefault()}
  function back(){move(window.location.href,false)}
  document.addEventListener('click',click);window.addEventListener(workspaceNavigationEvent,requested);window.addEventListener('popstate',back);
  return()=>{document.removeEventListener('click',click);window.removeEventListener(workspaceNavigationEvent,requested);window.removeEventListener('popstate',back)};
 },[]);
 let page=children;
 if(route!==null){
  const path=route.split('?')[0];
  if(path==='/'||path==='/my-feed')page=<FeedPage key={route} personal={path==='/my-feed'}/>;
  else if(path==='/login')page=children; // 💡 3. /login 접근 시 정상적으로 방어막 통과!
  else if(path==='/billing')page=<BillingPage key={route}/>;
  else if(path==='/mypage')page=<MyPage key={route}/>;
  else if(path==='/dopamine')page=<DopamineCenter key={route}/>;
  else if(path==='/today')page=<TodaySummary key={route}/>;
  else if(path==='/news')page=<NewsPage key={route}/>;
  else if(!account.ready)page=<div className="admin-page">계정 확인 중…</div>;
  else if(!account.user?.admin)page=<div className="admin-page"><h1>관리자 전용 페이지</h1><p>관리자 계정으로 로그인해 주세요.</p><a href="/">피드 목록으로 돌아가기</a></div>;
  else page=path==='/admin/billing'?<BillingAdmin/>:path==='/admin/dopamine'?<DopamineAdmin key={route}/>:path==='/admin'?<AdminHome/>:path==='/admin/rss'?<RssAdmin key={route}/>:path==='/admin/members'?<MemberAdmin key={route}/>:path==='/admin/prompts'?<PromptSettings key={route}/>:path==='/admin/seo'?<SeoSettings key={route}/>:<AiSettings key={route}/>;
 }
 return <div className="workspace-shell">{pageHasSidebar?page:<><NewsSidebar mobile={sidebarOpen} feeds={account.feeds} articleCount={account.articles.length} savedCount={account.saved.length} select={selectSidebar} onAdd={()=>setDirectoryOpen(true)} onDelete={id=>{account.setFeeds(feeds=>feeds.filter(f=>f.id!==id));account.setArticles(articles=>articles.filter(a=>a.feedId!==id))}} onClose={()=>setSidebarOpen(false)}/><div className="workspace-page-with-sidebar"><button type="button" className="workspace-mobile-menu" onClick={()=>setSidebarOpen(true)} aria-label="왼쪽 메뉴 열기" aria-expanded={sidebarOpen}><Menu size={20}/> 메뉴</button>{page}</div></>}{showYoutubePlayer&&<YoutubePlayer/>}{directoryOpen&&<FeedDirectory feeds={account.feeds} categories={account.categories} onAdd={feed=>account.setFeeds(feeds=>feeds.some(f=>f.url===feed.url)?feeds:[...feeds,feed])} onClose={()=>setDirectoryOpen(false)}/>}</div>;
}