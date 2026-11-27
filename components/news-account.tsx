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

// 🚀 Supabase profiles 테이블의 tier 값을 기반으로 구독 정보와 한도를 생성하는 헬퍼 함수
// 🚀 수정된 buildSubscription 함수 (TypeScript 타입 충돌 방지)
function buildSubscription(tier?: string | null, expiresAt?: string | null): Membership & { limits: typeof PLANS[keyof typeof PLANS] } {
  const planKey = (tier || 'free').toLowerCase() as keyof typeof PLANS;
  const validPlan = planKey in PLANS ? planKey : ('pro' in PLANS ? 'pro' : 'free');
  const limits = PLANS[validPlan] || PLANS.free;

  return {
    plan: validPlan,
    expiresAt: expiresAt || '',
    creditMonth: '',
    limits: limits as any // 👈 강제 타입 캐스팅으로 리터럴 타입 불일치 에러를 우회합니다
  };
}

function syncAuthCookies(session: any) {
  if (typeof document === 'undefined') return;
  if (session?.access_token) {
    const maxAge = 604800; // 7일
    document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${maxAge}; SameSite=Lax`;
    if (session.user?.id) {
      document.cookie = `userId=${session.user.id}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }
    if (session.user?.email) {
      document.cookie = `userEmail=${encodeURIComponent(session.user.email)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }
  }
}

function clearAuthCookies() {
  if (typeof document === 'undefined') return;
  document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax';
  document.cookie = 'userId=; path=/; max-age=0; SameSite=Lax';
  document.cookie = 'userEmail=; path=/; max-age=0; SameSite=Lax';
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
    return () => { live = false; };
  }, []);

  const [subscription, setSubscription] = useState<Membership & { limits: typeof PLANS[keyof typeof PLANS] }>({ plan: 'free', expiresAt: '', creditMonth: '', limits: PLANS.free });
  const [tokens, setTokens] = useState<number | null>(null);
  const [state, setState] = useState<State>(empty), [articles, setArticles] = useState<Article[]>([]), [ready, setReady] = useState(false), [user, setUser] = useState<User | null>(null), [status, setStatus] = useState('계정 확인 중'), [error, setError] = useState(''), [hasGuest, setHasGuest] = useState(false);
  const confirmed = useRef(state); const current = useRef(state), identity = useRef<User | null>(null), loadingUserId = useRef<string | null>(null), revision = useRef(0), pending = useRef<State | null>(null), saving = useRef(false), blocked = useRef(false);
  
  useEffect(() => {
    let live = true;

    // 🚀 Supabase DB(news_accounts + profiles)에서 유저 데이터와 PRO 등급을 함께 꺼내옵니다
    async function handleSession(session: any) {
      const nextId: string | undefined = session?.user?.id;
      if (!nextId) return;
      if (identity.current?.id === nextId || loadingUserId.current === nextId) {
        syncAuthCookies(session);
        return;
      }

      loadingUserId.current = nextId;
      syncAuthCookies(session);
      const supaUser: User = {
        id: nextId,
        name: session.user.user_metadata?.name || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '사용자',
        admin: false
      };
      identity.current = supaUser;
      setUser(prev => (prev && prev.id === supaUser.id && prev.name === supaUser.name && prev.admin === supaUser.admin) ? prev : supaUser);

      try {
        const loadUserData = async () => {
          // 1. profiles 테이블에서 등급(tier), 관리자 여부(is_admin), 만료일(expires_at), 토큰 조회
          const { data: profileData } = await supabase
            .from('profiles')
            .select('tier, is_admin, expires_at, tokens')
            .eq('id', session.user.id)
            .maybeSingle();

          if (profileData) {
            supaUser.admin = profileData.is_admin === true;
            setSubscription(buildSubscription(profileData.tier, profileData.expires_at));
          } else if (process.env.NODE_ENV === 'development') {
            // 로컬 개발 환경에서 매칭되는 profile 행이 없을 경우 local_seedy(pro) 기준으로 처리
            setSubscription(buildSubscription('pro', null));
          }

          // 2. news_accounts 테이블에서 피드 목록(state) 및 표시 이름 조회
          const { data } = await supabase
            .from('news_accounts')
            .select('state, tokens, display_name')
            .eq('user_id', session.user.id)
            .maybeSingle();

          let s = { ...empty() };

          if (data) {
            if (data.display_name) supaUser.name = data.display_name;
            setUser(prev => (prev && prev.id === supaUser.id && prev.name === supaUser.name && prev.admin === supaUser.admin) ? prev : { ...supaUser });

            if (data.state) {
              try {
                const parsedState = JSON.parse(data.state);
                s.feeds = parsedState.feeds || [];
                s.saved = parsedState.saved || [];
                s.read = parsedState.read || [];
                s.keywordFilters = parsedState.keywordFilters || parsedState.keyword_filters || defaultKeywordFilters;
                
                // profiles 테이블에 데이터가 없더라도 state 내부에 _membership이 있으면 반영
                if (!profileData && parsedState._membership?.plan) {
                  setSubscription(buildSubscription(parsedState._membership.plan, parsedState._membership.expiresAt));
                }
              } catch (e) {
                console.warn('State 압축 풀기 실패', e);
              }
            }
            setTokens(data.tokens ?? profileData?.tokens ?? 100);
          } else {
            setUser(prev => (prev && prev.id === supaUser.id && prev.name === supaUser.name && prev.admin === supaUser.admin) ? prev : { ...supaUser });
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
            setTokens(profileData?.tokens ?? 100);
          }

          current.current = s;
          confirmed.current = s;
          setState(s);
          setStatus('Supabase 연결됨');
        };

        // 안전 타임아웃 (8초): DB 조회가 지연되더라도 무한 대기 방지
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('세션 데이터 조회 시간 초과 (8초)')), 8000)
        );

        await Promise.race([loadUserData(), timeoutPromise]);
      } catch (err) {
        console.error('DB 데이터를 불러오지 못했습니다:', err);
        const fallback = { ...empty(), ...guest() };
        current.current = fallback;
        confirmed.current = fallback;
        setState(fallback);
        setTokens(100);
        setStatus('로컬 모드 (DB 연결 실패)');
      } finally {
        if (loadingUserId.current === nextId) {
          loadingUserId.current = null;
        }
        setReady(true);
      }
    }

    function clearSession() {
      loadingUserId.current = null;
      clearAuthCookies();
      identity.current = null;
      setUser(null);
      setSubscription({ plan: 'free', expiresAt: '', creditMonth: '', limits: PLANS.free });
      const s = { ...empty(), ...guest() };
      current.current = s;
      confirmed.current = s;
      setState(s);
      setStatus('이 브라우저에 저장');
      setReady(true);
    }

    // 초기 세션 로딩 안전 타임아웃 (8초): getSession() 자체가 지연되거나 멈출 경우 무한 대기 방지
    const initTimer = setTimeout(() => {
      if (live) {
        console.warn('[news-account] 초기 세션 로딩 안전 타임아웃 (8초)');
        clearSession();
      }
    }, 8000);

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!live) return;
      clearTimeout(initTimer);
      if (error) { supabase.auth.signOut(); clearSession(); }
      else if (session) { void handleSession(session); }
      else { clearSession(); }
    }).catch((err) => {
      if (!live) return;
      clearTimeout(initTimer);
      console.warn('[news-account] getSession 실패:', err);
      clearSession();
      setReady(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!live) return;
      if (event === 'TOKEN_REFRESHED') {
        if (session) syncAuthCookies(session);
        return;
      }
      if (event === 'SIGNED_IN' && session) {
        // 이미 같은 user.id로 로그인되어 있으면 토큰 쿠키만 갱신하고 DB/상태 재조회 차단
        if (identity.current?.id === session.user?.id || loadingUserId.current === session.user?.id) {
          syncAuthCookies(session);
          return;
        }
        void handleSession(session);
      } else if (event === 'SIGNED_OUT') {
        if (identity.current !== null || loadingUserId.current !== null) {
          clearSession();
        }
      }
    });

    setHasGuest(!!localStorage.getItem('nd-feeds') || !!localStorage.getItem('nd-saved'));
    try { setArticles((JSON.parse(localStorage.getItem('nd-cache') || '[]') as Article[])); } catch {}

    return () => {
      live = false;
      clearTimeout(initTimer);
      authListener.subscription.unsubscribe();
    };
  }, []);

  // 🚀 명시적 크레딧 변경 이벤트(feedai-tokens-changed) 발생 시에만 최신 등급과 토큰을 동기화 (focus 재조회 제거)
  useEffect(() => {
    const userId = user?.id;
    if (!ready || !userId) return;
    let live = true;
    async function refresh(event?: Event) {
      if (event instanceof CustomEvent && typeof event.detail === 'number') { setTokens(event.detail); return; }
      try {
        const [{ data: profileData }, { data: accountData }] = await Promise.all([
          supabase.from('profiles').select('tier, is_admin, expires_at, tokens').eq('id', userId).maybeSingle(),
          supabase.from('news_accounts').select('tokens, display_name').eq('user_id', userId).maybeSingle()
        ]);
        if (!live) return;
        if (profileData) {
          const nextSub = buildSubscription(profileData.tier, profileData.expires_at);
          setSubscription(prev => (prev.plan === nextSub.plan && prev.expiresAt === nextSub.expiresAt) ? prev : nextSub);
          setUser(old => {
            if (!old) return old;
            const nextAdmin = profileData.is_admin === true;
            return old.admin === nextAdmin ? old : { ...old, admin: nextAdmin };
          });
        }
        if (accountData) {
          const nextTokens = accountData.tokens ?? profileData?.tokens ?? 100;
          setTokens(prev => prev === nextTokens ? prev : nextTokens);
          if (accountData.display_name) {
            setUser(old => {
              if (!old) return old;
              return old.name === accountData.display_name ? old : { ...old, name: accountData.display_name };
            });
          }
        }
      } catch {}
    }
    window.addEventListener('feedai-tokens-changed', refresh);
    return () => { live = false; window.removeEventListener('feedai-tokens-changed', refresh); };
  }, [ready, user?.id]);
  
  // 🚀 유저가 피드를 추가/삭제할 때 DB로 실시간 꽂아 넣는 배관(Update)
  async function flush() {
    if (saving.current || blocked.current || !identity.current) return;
    saving.current = true;
    try {
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        setStatus('저장 중…');

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
          .eq('user_id', identity.current.id);

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
      void flush();
    } else {
      try { localStorage.setItem('nd-' + key, JSON.stringify(next[key])); } catch { setError('브라우저 저장 공간이 부족합니다.'); }
    }
  }

  const userId = user?.id;
  useEffect(() => { if (ready && !userId) try { localStorage.setItem('nd-cache', JSON.stringify(articles)); } catch {} }, [articles, ready, userId]);
  
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
    clearAuthCookies();
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