"use client";
import { isRecentFeedArticle } from "../lib/feed-window";
import { navigateWorkspace } from "../lib/workspace-navigation";
import { groupNews } from "../lib/news-grouping";
import TopMenu from "../components/top-menu";
import { useEffect, useState, useMemo, useRef } from "react";
import { useNewsTranslation } from "../hooks/use-news-translation";
import ArticleExcerpt from "../components/article-excerpt";
import FeedDirectory from "../components/feed-directory";
import { useNewsAccount } from "../components/news-account";
import NewsSidebar from "../components/news-sidebar";

import {
  Rss,
  Search,
  Bookmark,
  Plus,
  ArrowUpRight,
  X,
  Check,
  Globe,
  Newspaper,
  Trash2,
  Settings2,
  ChevronRight,
  Menu,
} from "lucide-react";
type Feed = { id: string; name: string; url: string; category: string };
type Article = {
  title: string;
  description: string;
  link: string;
  date: string | null;
  source: string;
  category: string;
  feedId: string;
};
function dateText(date: string | null) {
  if (!date) return "시간 미제공";
  const min = Math.floor((Date.now() - Date.parse(date)) / 60000);
  if (min < 0)
    return new Date(date).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  if (min < 60) return `${Math.max(1, min)}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return new Date(date).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
  });
}
export default function Page({
  personal = false,
}: { personal?: boolean } = {}) {
  const {
    subscription,
    keywordFilters,
    user,
    feeds,
    setFeeds,
    articles,
    setArticles,
    saved,
    setSaved,
    read,
    setRead,
    ready,
    categories,
  } = useNewsAccount();
  const [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [cat, setCat] = useState("전체"),
    [view, setView] = useState("news"),
    [source, setSource] = useState(""),
    [query, setQuery] = useState(""),
    [onlyUnread, setOnlyUnread] = useState(false),
    [modal, setModal] = useState(false),
    [updated, setUpdated] = useState(""),
    [mobile, setMobile] = useState(false);
  const [groupSimilar, setGroupSimilar] = useState(true);
  const running = useRef(false);
  const latestFeeds = useRef(feeds);
  latestFeeds.current = feeds;
  useEffect(() => {
    if (ready && user && !personal && window.location.pathname === "/") {
      navigateWorkspace("/my-feed" + window.location.search);
    }
  }, [ready, user, personal]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setView(params.get("view") === "saved" ? "saved" : "news");
    const selectedCategory = params.get("category") || "전체";
    setCat(selectedCategory);
    setSource(params.get("source") || "");
  }, []);
  async function refresh() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const currentFeeds = user
      ? latestFeeds.current.slice(0, subscription.limits.feeds)
      : latestFeeds.current;
    const results: { id: string; items: Article[]; error: string }[] = [];
    for (let offset = 0; offset < currentFeeds.length; offset += 6)
      results.push(
        ...(await Promise.all(
          currentFeeds.slice(offset, offset + 6).map(async (f) => {
            try {
              let r = await fetch("/api/feed?url=" + encodeURIComponent(f.url));
              for (
                let attempt = 0;
                attempt < 2 && r.status === 503;
                attempt++
              ) {
                await r.body?.cancel();
                await new Promise((resolve) =>
                  setTimeout(resolve, 5000 + Math.random() * 2000),
                );
                r = await fetch("/api/feed?url=" + encodeURIComponent(f.url));
              }
              const data: any = await r.json();
              if (!r.ok) throw new Error(data.error);
              return {
                id: f.id,
                items: data.items.map((a: Article) => ({
                  ...a,
                  source: f.name,
                  category: f.category,
                  feedId: f.id,
                })),
                error: "",
              };
            } catch (e) {
              return {
                id: f.id,
                items: [],
                error: e instanceof Error ? e.message : "연결 실패",
              };
            }
          }),
        )),
      );
    setArticles((old) =>
      results
        .flatMap((r) =>
          r.error ? old.filter((a) => a.feedId === r.id) : r.items,
        )
        .filter((a) => isRecentFeedArticle(a)),
    );
    setErrors(
      Object.fromEntries(
        results.filter((r) => r.error).map((r) => [r.id, r.error]),
      ),
    );
    setUpdated(
      new Date().toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    setBusy(false);
    running.current = false;
    if (
      currentFeeds.map((f) => f.id).join() !==
      latestFeeds.current
        .slice(0, user ? subscription.limits.feeds : undefined)
        .map((f) => f.id)
        .join()
    )
      refresh();
  }
  useEffect(() => {
    if (!ready) return;
    refresh();
    const t = setInterval(
      refresh,
      user ? subscription.limits.refreshMs : 10800000,
    );
    return () => clearInterval(t);
  }, [ready, feeds, subscription.plan]);
  const eligible = useMemo(
    () =>
      (view === "saved" ? saved : articles)
        .filter((a) => {
          if (!user || !personal) return true;
          const text = keywordFilters.fields
            .map((field) => a[field] || "")
            .join(" ")
            .normalize("NFKC")
            .toLocaleLowerCase();
          const matches = (word: string) =>
            text.includes(word.normalize("NFKC").toLocaleLowerCase());
          const white = keywordFilters.white.slice(
              0,
              subscription.limits.keywords,
            ),
            black = keywordFilters.black.slice(0, subscription.limits.keywords);
          return (!white.length || white.some(matches)) && !black.some(matches);
        })
        .filter(
          (a) =>
            (cat === "전체" || a.category === cat) &&
            (!source || a.feedId === source) &&
            (!onlyUnread || !read.includes(a.link)) &&
            `${a.title} ${a.description} ${a.source}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        ),
    [
      articles,
      saved,
      view,
      cat,
      source,
      onlyUnread,
      read,
      query,
      user,
      keywordFilters,
      personal,
      subscription.plan,
    ],
  );
  const grouped = useMemo(
    () => groupNews(eligible, groupSimilar),
    [eligible, groupSimilar],
  );
  const filtered = useMemo(
    () => grouped.groups.map((g) => g.article),
    [grouped],
  );

  useEffect(() => {
    if (!categories.includes(cat)) setCat("전체");
  }, [categories]);
  const translationItems = useMemo(
    () => grouped.groups.flatMap((g) => [g.article, ...g.related]),
    [grouped],
  );
  const translation = useNewsTranslation(translationItems);
  function articleHref(a: Article) {
    const t = translation.translations[a.link];
    const title =
      translation.enabled && t?.originalTitle === a.title ? t.title : a.title;
    const summary =
      translation.enabled && t?.originalDescription === a.description
        ? t.description
        : a.description;
    return (
      "/news?" +
      new URLSearchParams({
        title,
        summary,
        url: a.link,
        feedId: a.feedId,
      }).toString()
    );
  }
  function toggleSave(a: Article) {
    setSaved((s) =>
      s.some((x) => x.link === a.link)
        ? s.filter((x) => x.link !== a.link)
        : [a, ...s],
    );
  }
  function select(v: string, c = "전체", s = "") {
    setView(v);
    setCat(c);
    setSource(s);
    setMobile(false);
    if (v === "news" && c === "전체" && !s) {
      setQuery("");
      setOnlyUnread(false);
    }
  }
  if (!ready)
    return (
      <div className="personal-gate" role="status">
        계정과 나의 피드를 불러오는 중…
      </div>
    );
  if (personal && !user)
    return (
      <div className="personal-gate">
        <h1>나만의 피드 페이지</h1>
        <p>가입 · 로그인 후 관심 있는 소스를 선택하세요.</p>
        <a className="refresh" href="/login" target="_top">가입 · 로그인</a>
        <a href="/">공용 시작 화면</a>
      </div>
    );
  return (
    <div className="shell">
      <NewsSidebar
        mobile={mobile}
        feeds={feeds}
        articleCount={articles.length}
        savedCount={saved.length}
        view={view}
        cat={cat}
        source={source}
        errors={errors}
        select={select}
        onAdd={() => setModal(true)}
        onClose={() => setMobile(false)}
        onDelete={(id) => {
          setFeeds((fs) => fs.filter((x) => x.id !== id));
          setArticles((a) => a.filter((x) => x.feedId !== id));
          if (source === id) setSource("");
        }}
      />
      <main>
        <header className="topbar">
          <button
            className="mobile-toggle"
            onClick={() => setMobile(!mobile)}
            aria-label="메뉴"
          >
            <Menu />
          </button>
          <TopMenu
            onMyFeed={() => {
              select("news");
              window.history.replaceState(null, "", window.location.pathname);
              window.scrollTo(0, 0);
            }}
          />
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <p className="eyebrow">YOUR DAILY PERSPECTIVE</p>
              <h1>
                {view === "saved"
                  ? "다시 읽고 싶은 피드"
                  : source
                    ? feeds.find((f) => f.id === source)?.name
                    : cat === "전체"
                      ? user
                        ? "나만의 피드"
                        : "세상을 읽는 나만의 시선"
                      : cat + " 피드"}
              </h1>
              <p className="subtitle">
                관심 있는 소식만, 한곳에서. 나만의 정보 흐름을 만들어 보세요.
              </p>
            </div>
          </div>
          {user && (
            <section className="personal-feed-banner">
              <div>
                <h2>
                  {feeds.length ? "내 구독 설정" : "첫 피드를 선택해 주세요"}
                </h2>
                <p>
                  {feeds.length
                    ? "선택한 소스만 이 계정의 피드에 표시됩니다. 다른 기기에서도 로그인하면 같은 구독 목록을 불러옵니다."
                    : "공용 RSS 목록에서 관심 있는 소스를 구독하거나 RSS 주소를 직접 등록하세요."}
                </p>
              </div>
              <button
                type="button"
                className="refresh"
                onClick={() => setModal(true)}
              >
                <Plus size={16} /> 피드 선택 · 추가
              </button>
            </section>
          )}
          <div className="overview">
            <div>
              <span className="metric-icon">
                <Newspaper size={20} />
              </span>
              <p>
                수집된 피드
                <strong>
                  {articles.length}
                  <small>개</small>
                </strong>
              </p>
            </div>
            <div>
              <span className="metric-icon purple">
                <Rss size={20} />
              </span>
              <p>
                구독 중인 소스
                <strong>
                  {feeds.length}
                  <small>개</small>
                </strong>
              </p>
            </div>
            <div>
              <span className="metric-icon amber">
                <Bookmark size={20} />
              </span>
              <p>
                저장한 피드
                <strong>
                  {saved.length}
                  <small>개</small>
                </strong>
              </p>
            </div>
            <div className="update-metric">
              <span className="live-dot" />
              <p>
                {busy
                  ? "최신 피드를 불러오고 있어요"
                  : (user ? subscription.limits.refreshMs : 10800000) ===
                      10800000
                    ? "3시간마다 자동으로 새로고침"
                    : subscription.limits.refreshMs === 1800000
                      ? "30분마다 자동으로 새로고침"
                      : "10분마다 자동으로 새로고침"}
                <small>
                  {updated
                    ? "마지막 확인 " + updated + " · 한국시간"
                    : "페이지를 열어 둔 동안 갱신됩니다"}
                </small>
              </p>
            </div>
          </div>
          <div className="toolbar">
            <div className="tabs">
              {categories.map((c) => (
                <button
                  key={c}
                  className={cat === c ? "tab chosen" : "tab"}
                  onClick={() => {
                    setCat(c);
                    setSource("");
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="search">
              <Search size={17} />
              <input
                placeholder="제목, 키워드 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="검색 지우기">
                  <X size={14} />
                </button>
              )}
            </label>
          </div>
          <div className="translation-bar">
            <div>
              <b>다국어 피드 자동 번역</b>
              <span>
                {translation.status === "ready"
                  ? translation.enabled
                    ? translation.pending
                      ? `한국어로 번역 중 · ${translation.pending}개`
                      : "제목·요약을 한국어로 표시"
                    : "원문을 표시합니다"
                  : translation.status === "downloading"
                    ? `언어팩 준비 중 ${translation.progress}%`
                    : translation.notice}
              </span>
            </div>
            {translation.status === "ready" && translation.needsActivation && (
              <button onClick={translation.start}>새 언어팩 준비</button>
            )}
            {translation.status === "ready" ? (
              <button onClick={translation.toggle}>
                {translation.enabled ? "원문 보기" : "한국어 번역 보기"}
              </button>
            ) : (
              translation.status !== "unsupported" && (
                <button
                  onClick={translation.start}
                  disabled={
                    translation.status === "checking" ||
                    translation.status === "downloading"
                  }
                >
                  {translation.status === "downloading"
                    ? "다운로드 중…"
                    : "자동 번역 켜기"}
                </button>
              )
            )}
          </div>
          {translation.status === "ready" && translation.notice && (
            <p className="translation-notice">{translation.notice}</p>
          )}
          <div className="news-grouping-control">
            <label>
              <input
                type="checkbox"
                checked={groupSimilar}
                onChange={(e) => setGroupSimilar(e.target.checked)}
              />{" "}
              중복 제거 · 비슷한 피드 묶기
            </label>
            <span>
              {groupSimilar
                ? `최근 48시간 · 중복 ${grouped.hidden}개 숨김 · 관련 기사 ${grouped.groups.reduce((n, g) => n + g.related.length, 0)}개 묶음`
                : "모든 기사 표시"}
            </span>
          </div>
          <div className="list-heading">
            <h2>
              {view === "saved" ? "저장한 피드" : "최신 피드"}{" "}
              <span>{filtered.length}</span>
            </h2>
            <label className="unread">
              <input
                type="checkbox"
                checked={onlyUnread}
                onChange={(e) => setOnlyUnread(e.target.checked)}
              />{" "}
              읽지 않은 피드만
            </label>
            <span className="sort">최신순 ↓</span>
          </div>
          {Object.keys(errors).length > 0 && (
            <details className="errors">
              <summary>
                {Object.keys(errors).length}개 소스의 피드를 가져오지 못했습니다
                · 상세 보기
              </summary>
              {feeds
                .filter((f) => errors[f.id])
                .map((f) => (
                  <p key={f.id}>
                    {f.name}: {errors[f.id]}
                  </p>
                ))}
              <p>
                이전에 수집한 피드는 유지됩니다. RSS 주소를 확인해 주세요.
                요금제의 갱신 간격에 맞춰 자동으로 다시 연결합니다.
              </p>
            </details>
          )}
          <div className="news-list">
            {grouped.groups.map(({ article: a, related }, i) => (
              <article
                key={a.link}
                className={
                  read.includes(a.link) ? "article is-read" : "article"
                }
              >
                <span className="article-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="article-body">
                  <div className="article-meta">
                    <span className="category-tag">{a.category}</span>
                    <b>{a.source}</b>
                    <span>·</span>
                    <time
                      title={
                        a.date
                          ? new Date(a.date).toLocaleString("ko-KR", {
                              timeZone: "Asia/Seoul",
                            })
                          : ""
                      }
                    >
                      {dateText(a.date)}
                    </time>
                    {translation.enabled &&
                      translation.translations[a.link]?.originalTitle ===
                        a.title && (
                        <span className="translated-badge">자동 번역</span>
                      )}
                    {read.includes(a.link) && (
                      <span className="read-badge">
                        <Check size={12} /> 읽음
                      </span>
                    )}
                  </div>
                  <a
                    className="article-title"
                    href={articleHref(a)}
                    onClick={() =>
                      setRead((r) => (r.includes(a.link) ? r : [...r, a.link]))
                    }
                  >
                    {translation.enabled &&
                    translation.translations[a.link]?.originalTitle === a.title
                      ? translation.translations[a.link].title
                      : a.title}
                    <ArrowUpRight size={17} />
                  </a>
                  {a.description ? (
                    <p className="description">
                      {translation.enabled &&
                      translation.translations[a.link]?.originalDescription ===
                        a.description
                        ? translation.translations[a.link].description
                        : a.description}
                    </p>
                  ) : (
                    <ArticleExcerpt url={a.link} compact />
                  )}
                  <a
                    className="original"
                    href={articleHref(a)}
                    onClick={() =>
                      setRead((r) => (r.includes(a.link) ? r : [...r, a.link]))
                    }
                  >
                    피드 보기 <ChevronRight size={12} />
                  </a>
                  {related.length > 0 && (
                    <details className="related-news">
                      <summary>관련 기사 {related.length}개</summary>
                      <ul>
                        {related.map((item) => (
                          <li key={item.link}>
                            <a
                              href={articleHref(item)}
                              onClick={() =>
                                setRead((r) =>
                                  r.includes(item.link) ? r : [...r, item.link],
                                )
                              }
                            >
                              {translation.enabled &&
                              translation.translations[item.link]
                                ?.originalTitle === item.title
                                ? translation.translations[item.link].title
                                : item.title}
                            </a>
                            <div>
                              <span>
                                {item.source} · {dateText(item.date)}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleSave(item)}
                              >
                                {saved.some((s) => s.link === item.link)
                                  ? "저장 취소"
                                  : "저장"}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <button
                  className={
                    saved.some((s) => s.link === a.link)
                      ? "save-button saved"
                      : "save-button"
                  }
                  onClick={() => toggleSave(a)}
                  aria-label={
                    saved.some((s) => s.link === a.link)
                      ? "즐겨찾기 해제"
                      : "즐겨찾기 저장"
                  }
                >
                  <Bookmark size={19} />
                </button>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <div className="empty">
              <Rss size={35} />
              <h3>
                {busy
                  ? "피드를 수집하고 있습니다"
                  : view === "saved"
                    ? "좋은 기사를 저장해 두세요"
                    : !feeds.length
                      ? "관심 있는 피드를 선택하세요"
                      : "표시할 피드가 없습니다"}
              </h3>
              <p>
                {view === "saved"
                  ? "기사 옆의 책갈피를 누르면 여기에 모입니다."
                  : user
                    ? "검색·필터를 변경하거나 RSS 소스를 추가해 보세요."
                    : "검색·필터를 변경해 보세요."}
              </p>
              {user && (
                <button className="refresh" onClick={() => setModal(true)}>
                  <Plus size={15} /> RSS 추가
                </button>
              )}
            </div>
          )}
          <footer className="page-footer">
            <span>
              NEWS DESK <i>작은 습관, 더 넓은 시야.</i>
            </span>
            <span>RSS 제공 요약 · 자동 번역은 원문과 함께 확인하세요</span>
          </footer>
        </div>
      </main>
      {user && modal && (
        <FeedDirectory
          feeds={feeds}
          categories={categories}
          onAdd={(feed) =>
            setFeeds((previous) =>
              previous.some((f) => f.url === feed.url)
                ? previous
                : [...previous, feed],
            )
          }
          onClose={() => setModal(false)}
        />
      )}
    </div>
  );
}
