'use client';
import { PLANS, type Membership } from '../lib/plans';
import { isRecentFeedArticle } from '../lib/feed-window';
import { createContext, useContext, useEffect, useRef, useState, useMemo, type ReactNode, type SetStateAction } from 'react';
import { resolveCategory } from '../lib/category-names';
import { categories as baseCategories, type Feed } from '../lib/news-config';
import { supabase } from '../lib/supabase'; // 공용 스캐너 사용

type Article = { title: string; description: string; link: string; date: string | null; source: string; category: string; feedId: string };
export type KeywordFilters = { white: string[]; black: string[]; fields: ('title' | 'description')[] };
export const defaultKeywordFilters: KeywordFilters = { white: [], black: [], fields: ['title', 'description'] };
type State = { keywordFilters: KeywordFilters; feeds: Feed[]; saved: Article[]; read: string[] };
type User = { id: string; name: string; admin?: boolean };
type Context = { subscription: Membership & { limits: typeof PLANS[keyof typeof PLANS] }; keywordFilters: KeywordFilters; setKeywordFilters: (v: SetStateAction<KeywordFilters>) => void; tokens: number | null; updateTokens: (n: number) => void; categories: string[]; feeds: Feed[]; saved: Article[]; read: string[]; articles: Article[]; setFeeds: (v: SetStateAction<Feed[]>) => void; setSaved: (v: SetStateAction<Article[]>) => void; setRead: (v: SetStateAction<string[]>) => void; setArticles: (v: SetStateAction<Article[]>) => void; ready: boolean; user: User | null; status: string; error: string; retry: () => void; importGuest: () => void; hasGuest: boolean };
const Account = createContext<Context | null>(null);

const empty = (): State => ({ keywordFilters: defaultKeywordFilters, feeds: [], saved: [], read: [] });

function guest(): State {
  try {
    return {
      keywordFilters: defaultKeywordFilters,
      feeds: JSON.parse(localStorage.getItem('nd-feeds') || 'null') || [],
      saved: JSON.parse(localStorage.getItem('nd-saved') || '[]'),
      read: JSON.parse(localStorage.getItem('nd-read') || '[]')
    };
  } catch {
    return empty();
  }
}

export function NewsAccountProvider({ children }: { children: ReactNode }) {
  const [categoryMapping, setCategoryMapping] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<string[]>(baseCategories);
  
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const r = await fetch('/api/categories', { cache: 'no-store' });
        const d: any = await r.json();
        if (r.ok && live) { setCategories(['전체', ...d.categories]); setCategoryMapping(d.mapping || {}); }
      } catch {}
    }
    void load();
    window.addEventListener('focus', load);
    return () => { live = false; window.removeEventListener('focus', load); };
  }, []);

  const [subscription, setSubscription] = useState<Membership & { limits: typeof PLANS[keyof typeof PLANS] }>({ plan: 'free', expiresAt: '', creditMonth: '', limits: PLANS.free });
  const [tokens, setTokens] = useState<number | null>(null);
  const [state, setState] = useState<State>(empty), [articles, setArticles] = useState<Article[]>([]), [ready, setReady] = useState(false), [user, setUser] = useState<User | null>(null), [status, setStatus] = useState('계정 확인 중'), [error, setError] = useState(''), [hasGuest, setHasGuest] = useState(false);
  const confirmed = useRef(state); const current = useRef(state), identity = useRef<User | null>(null), revision = useRef(0), pending = useRef<State | null>(null), saving = useRef(false), blocked = useRef(false);
  
  useEffect(() => {
    let live = true;

    // 🚀 3. Supabase DB에서 진짜 유저 데이터를 꺼내오는 배관 연결 (user_id 및 state 기둥 적용)
    async function handleSession(session: any) {
      const supaUser = {
        id: session.user.id,
        name: session.user.user_metadata?.name || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '사용자',
        admin: true
      };
      identity.current = supaUser;
      setUser(supaUser);

      try {
        const { data, error: fetchError } = await supabase
          .from('news_accounts')
          .select('state, tokens, display_name')
          .eq('user_id', session.user.id)
          .single();

        let s = { ...empty() };

        if (data) {
          // 기존 유저: DB에 데이터가 존재하면 state 문자열을 풀어서 덮어쓰기
          if (data.display_name) supaUser.name = data.display_name;
          setUser({ ...supaUser });

          if (data.state) {
            try {
              const parsedState = JSON.parse(data.state);
              s.feeds = parsedState.feeds || [];
              s.saved = parsedState.saved || [];
              s.read = parsedState.read || [];
              s.keywordFilters = parsedState.keywordFilters || parsedState.keyword_filters || defaultKeywordFilters;
            } catch (e) {
              console.warn('State 압축 풀기 실패', e);
            }
          }
          setTokens(data.tokens ?? 100);
        } else {
          // 신규 유저: 유저 정보가 없으면 DB에 최초 방(Row)을 만들어줍니다!
          s = { ...empty(), ...guest() };
          const initialPayload = {
            user_id: session.user.id,
            email: session.user.email || '',
            display_name: supaUser.name,
            state: JSON.stringify(s),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          await supabase.from('news_accounts').insert(initialPayload);
          setTokens(100);
        }

        current.current = s;
        confirmed.current = s;
        setState(s);
        setStatus('Supabase 연결됨');
      } catch (err) {
        console.error('DB 데이터를 불러오지 못했습니다:', err);
        const fallback = { ...empty(), ...guest() };
        current.current = fallback;
        confirmed.current = fallback;
        setState(fallback);
        setTokens(100);
        setStatus('로컬 모드 (DB 연결 실패)');
      } finally {
        setReady(true);
      }
    }

    function clearSession() {
      identity.current = null;
      setUser(null);
      const s = { ...empty(), ...guest() };
      current.current = s;
      confirmed.current = s;
      setState(s);
      setStatus('이 브라우저에 저장');
      setReady(true);
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) { supabase.auth.signOut(); clearSession(); }
      else if (session) { handleSession(session); }
      else { clearSession(); }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!live) return;
      if (event === 'SIGNED_IN' && session) { handleSession(session); }
      else if (event === 'SIGNED_OUT') { clearSession(); }
    });

    setHasGuest(!!localStorage.getItem('nd-feeds') || !!localStorage.getItem('nd-saved'));
    try { setArticles((JSON.parse(localStorage.getItem('nd-cache') || '[]') as Article[])); } catch {}

    return () => { live = false; authListener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!ready || !user) return;
    let live = true;
    async function refresh(event?: Event) {
      if (event instanceof CustomEvent && typeof event.detail === 'number') { setTokens(event.detail); return; }
      try {
        const r = await fetch('/api/tokens', { cache: 'no-store' });
        const d = await r.json() as { tokens: number; name?: string; subscription?: Membership & { limits: typeof PLANS[keyof typeof PLANS] } };
        if (r.ok && live) {
          setTokens(d.tokens);
          if (d.subscription) setSubscription(d.subscription);
          if (d.name) setUser(old => old ? { ...old, name: d.name! } : old);
        }
      } catch {}
    }
    window.addEventListener('feedai-tokens-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { live = false; window.removeEventListener('feedai-tokens-changed', refresh); window.removeEventListener('focus', refresh); };
  }, [ready, user?.id]);
  
  // 🚀 4. 유저가 피드를 추가/삭제할 때 DB로 실시간 꽂아 넣는 배관(Update)
  async function flush() {
    if (saving.current || blocked.current || !identity.current) return;
    saving.current = true;
    try {
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        setStatus('저장 중…');

        // 여러 데이터를 하나의 문자열(JSON.stringify)로 압축해서 state 기둥에 쏙 넣습니다.
        const { error: updateError } = await supabase
          .from('news_accounts')
          .update({
            state: JSON.stringify({
              feeds: next.feeds,
              saved: next.saved,
              read: next.read,
              keywordFilters: next.keywordFilters
            }),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', identity.current.id); // id 대신 user_id 사용!

        if (updateError) throw updateError;
        confirmed.current = next;
      }
      setStatus('Supabase 연결됨');
      setError('');
    } catch (e) {
      setStatus('저장 실패');
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      saving.current = false;
    }
  }
  
  function change<K extends keyof State>(key: K, value: SetStateAction<State[K]>) {
    if (!ready || blocked.current || (!identity.current && key === 'feeds')) return;
    const updated = typeof value === 'function' ? (value as (s: State[K]) => State[K])(current.current[key]) : value;
    
    if (identity.current && key === 'feeds' && (updated as Feed[]).length > subscription.limits.feeds && (updated as Feed[]).length >= current.current.feeds.length) {
      setError('현재 요금제의 피드 한도는 ' + subscription.limits.feeds + '개입니다.'); return;
    }
    if (identity.current && key === 'keywordFilters') {
      const f = updated as KeywordFilters;
      if ((f.white.length > subscription.limits.keywords && f.white.length >= current.current.keywordFilters.white.length) || (f.black.length > subscription.limits.keywords && f.black.length >= current.current.keywordFilters.black.length)) {
        setError('키워드 한도는 각각 ' + subscription.limits.keywords + '개입니다.'); return;
      }
    }
    
    const next = { ...current.current, [key]: updated };
    current.current = next;
    setState(next);
    
    if (identity.current) {
      pending.current = next;
      void flush(); // DB 저장 함수 실행 트리거
    } else {
      try { localStorage.setItem('nd-' + key, JSON.stringify(next[key])); } catch { setError('브라우저 저장 공간이 부족합니다.'); }
    }
  }

  useEffect(() => { if (ready && !user) try { localStorage.setItem('nd-cache', JSON.stringify(articles)); } catch {} }, [articles, ready, user]);
  
  function importGuest() {
    if (!user || !ready) return;
    const g = guest();
    change('feeds', old => [...old, ...g.feeds.filter(f => !old.some(x => x.url === f.url))]);
    change('saved', old => [...old, ...g.saved.filter(a => !old.some(x => x.link === a.link))]);
    change('read', old => Array.from(new Set([...old, ...g.read])));
    setHasGuest(false);
  }
  
  const displayFeeds = useMemo(() => state.feeds.map(f => ({ ...f, category: resolveCategory(f.category, categoryMapping) })), [state.feeds, categoryMapping]);
  const displayArticles = useMemo(() => articles.filter(a => isRecentFeedArticle(a)).map(a => ({ ...a, category: resolveCategory(a.category, categoryMapping) })), [articles, categoryMapping]);
  const displaySaved = useMemo(() => state.saved.map(a => ({ ...a, category: resolveCategory(a.category, categoryMapping) })), [state.saved, categoryMapping]);
  
  return (
    <Account.Provider value={{ ...state, subscription, tokens, updateTokens: setTokens, feeds: displayFeeds, saved: displaySaved, categories, articles: displayArticles, setArticles, setKeywordFilters: v => change('keywordFilters', v), setFeeds: v => change('feeds', v), setSaved: v => change('saved', v), setRead: v => change('read', v), ready, user, status, error, hasGuest, importGuest, retry: () => { if (!ready || blocked.current) window.location.reload(); else void flush(); } }}>
      {children}
    </Account.Provider>
  );
}

export function useNewsAccount() {
  const value = useContext(Account);
  if (!value) throw Error('Account provider missing');
  return value;
}

export function AccountPanel() {
  const a = useNewsAccount();
  const [returnTo, setReturnTo] = useState('/my-feed');
  useEffect(() => { setReturnTo(window.location.pathname === '/' ? '/my-feed' : window.location.pathname + window.location.search); }, []);
  
  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    await supabase.auth.signOut();
    window.location.href = '/'; 
  };

  return (
    <div className="account-panel">
      {a.status !== 'Supabase 연결됨' && a.status !== '이 브라우저에 저장' && <small aria-live="polite">{a.status}</small>}
      {a.user ? (
        <>
          {a.user.admin && <a className="account-link" href="/admin">관리자 페이지</a>}
          <a className="account-link" href="#" onClick={handleLogout}>로그아웃</a>
          {a.hasGuest && <button className="account-import" onClick={a.importGuest}>이 브라우저 기록 가져오기</button>}
        </>
      ) : (
        <>
          <a className="account-link" href={'/login?return_to=' + encodeURIComponent(returnTo)} target="_top">가입 · 로그인</a>
          <p>가입 후 원하는 RSS를 골라 나만의 피드 페이지를 만드세요.</p>
        </>
      )}
      {a.error && <div role="alert" className="account-error">{a.error}<button onClick={a.retry}>다시 시도</button></div>}
    </div>
  );
}