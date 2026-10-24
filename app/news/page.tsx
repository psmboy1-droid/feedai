'use client';
import {navigateWorkspace} from '../../lib/workspace-navigation';
import TopMenu from '../../components/top-menu';
import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowUpRight,ChevronRight,Menu} from 'lucide-react';
import NewsAnalysis from '../../components/news-analysis';
import ArticleContent from '../../components/article-content';
import {useNewsAccount} from '../../components/news-account';
import NewsSidebar from '../../components/news-sidebar';
import FeedDirectory from '../../components/feed-directory';
import {type Feed} from '../../lib/news-config';
export default function NewsPage(){
 const [article,setArticle]=useState<{title:string;summary:string;url:string;feedId:string}|null>(null);
 const {user,feeds,setFeeds,articles,setArticles,saved,categories,ready}=useNewsAccount();const articleCount=articles.length,savedCount=saved.length;const [mobile,setMobile]=useState(false),[modal,setModal]=useState(false);
 useEffect(()=>{const params=new URLSearchParams(window.location.search);let url='';try{const u=new URL(params.get('url')||'');if(['http:','https:'].includes(u.protocol))url=u.href}catch{}setArticle({title:(params.get('title')||'피드를 찾을 수 없습니다').slice(0,1000),summary:(params.get('summary')||'제공된 요약이 없습니다.').slice(0,2000),url,feedId:params.get('feedId')||''});},[]);
 function select(view:string,category='전체',source=''){const params=new URLSearchParams();if(view==='saved')params.set('view','saved');if(category!=='전체')params.set('category',category);if(source)params.set('source',source);navigateWorkspace((user?'/my-feed':'/')+(params.size?'?'+params.toString():''))}
 function addFeed(feed:Feed){setFeeds(old=>old.some(f=>f.url===feed.url)?old:[...old,feed])}
 function deleteFeed(id:string){setFeeds(old=>old.filter(f=>f.id!==id));setArticles(old=>old.filter(a=>a.feedId!==id))}
 return <div className="shell detail-page"><NewsSidebar mobile={mobile} feeds={feeds} articleCount={articleCount} savedCount={savedCount} select={select} onAdd={()=>setModal(true)} onDelete={deleteFeed} onClose={()=>setMobile(false)}/><main className="detail-workspace"><header className="topbar"><button className="mobile-toggle" onClick={()=>setMobile(!mobile)} aria-label="메뉴" aria-expanded={mobile}><Menu/></button><TopMenu/><a className="detail-back" href={user?"/my-feed":"/"}><ArrowLeft size={16}/> 피드 목록</a></header><div className="detail-main"><article className="detail-card" aria-busy={!article}>{article?<><h1>{article.title}</h1>{article.url&&<ArticleContent key={article.url} url={article.url} summary={article.summary} ready={ready} feedUrl={feeds.find(f=>f.id===(article.feedId||articles.find(a=>a.link===article.url)?.feedId||saved.find(a=>a.link===article.url)?.feedId))?.url}/>}{article.url?<a className="original-button" href={article.url} target="_blank" rel="noopener noreferrer">원문 바로가기 <ArrowUpRight size={15}/></a>:<p className="detail-loading">원문 주소를 불러오려면 피드 목록에서 다시 클릭해 주세요.</p>}</>:<p className="detail-loading">피드를 불러오는 중…</p>}</article>{article&&<NewsAnalysis article={article}/>}</div></main>{modal&&<FeedDirectory feeds={feeds} categories={categories} onAdd={addFeed} onClose={()=>setModal(false)}/>}</div>
}
