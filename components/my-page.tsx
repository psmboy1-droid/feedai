'use client';
import {useState} from 'react';
import PlanSettings from './plan-settings';
import {useNewsAccount} from './news-account';
import KeywordSettings from './keyword-settings';
import TopMenu from './top-menu';
export default function MyPage(){const {user,ready}=useNewsAccount();const [tab,setTab]=useState('filters');return <div className="member-page"><header className="topbar"><TopMenu/></header><main className="member-settings-main"><h1>마이 페이지</h1>{!ready?<p>계정 확인 중…</p>:!user?<p>로그인 후 필터를 설정할 수 있습니다. <a href="/login?return_to=%2Fmypage" target="_top">가입 · 로그인</a></p>:<><nav className="member-settings-tabs" aria-label="마이 페이지 카테고리"><button onClick={()=>setTab('filters')} aria-pressed={tab==='filters'}>필터</button><button onClick={()=>setTab('plans')} aria-pressed={tab==='plans'}>요금제</button><a href="/billing">결제·구독</a></nav>{tab==='plans'?<PlanSettings/>:<><h2>키워드 필터 설정</h2><p>내 피드에 표시할 키워드와 숨길 키워드를 관리하세요.</p><KeywordSettings/></>}</>}</main></div>}
