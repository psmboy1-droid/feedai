import { isRecentFeedArticle } from "../../../lib/feed-window";
import { XMLParser } from "fast-xml-parser";

export const dynamic = 'force-dynamic';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

interface CachedFeed {
  title: string;
  items: any[];
  updatedAt: string;
  expiresAt: number;
}

const feedCache = new Map<string, CachedFeed>();
const pendingFetches = new Map<string, Promise<{ title: string; items: any[]; updatedAt: string }>>();
const CACHE_TTL_MS = 3 * 60 * 1000;       // 3분 캐시
const STALE_TTL_MS = 30 * 60 * 1000;      // 원격 서버 일시 장애 시 최대 30분 stale 캐시 제공
const MAX_CACHE_ENTRIES = 300;

const list = (v: any) => (v ? (Array.isArray(v) ? v : [v]) : []);
const str = (v: any): string =>
  typeof v === "string"
    ? v
    : typeof v === "number"
      ? String(v)
      : Array.isArray(v)
        ? v.map(str).join(" ")
        : v?.["#text"] || v?.["#cdata"] || "";
const plain = (v: any) =>
  str(v)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function valid(raw: string) {
  const u = new URL(raw);

  // 🚀 로컬 개발 환경(development)일 경우에만 SSRF 차단(localhost, 포트번호 등)을 안전하게 우회하여 테스트를 허용합니다.
  if (process.env.NODE_ENV === 'development') {
    return u;
  }

  // 🛡️ 리눅스 실서버(production) 배포 시에는 해킹 방지를 위해 내부망 주소를 철저히 차단합니다.
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port ||
    !u.hostname.includes(".") ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      u.hostname,
    ) ||
    u.hostname.includes(":") ||
    /\.(local|internal)$/.test(u.hostname)
  )
    throw new Error("공개 HTTP 또는 HTTPS RSS 주소를 입력해 주세요.");
  return u;
}

async function fetchAndParseFeed(targetUrl: URL): Promise<{ title: string; items: any[]; updatedAt: string }> {
  let u = targetUrl;
  let res: Response | undefined;
  for (let n = 0; n < 4; n++) {
    res = await fetch(u, {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "User-Agent": "FeedAI RSS Reader/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 300 && res.status < 400) {
      u = valid(new URL(res.headers.get("location") || "", u).href);
      continue;
    }
    break;
  }
  if (!res?.ok) {
    throw new Error(`피드 응답 오류 (${res?.status || "연결 실패"})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw Error("빈 피드입니다.");
  let xml = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 3000000) {
      await reader.cancel();
      throw Error("피드 용량이 너무 큽니다.");
    }
    xml += decoder.decode(value, { stream: true });
  }
  xml += decoder.decode();

  const doc = parser.parse(xml);
  const root = doc.rss?.channel || doc.feed || doc["rdf:RDF"];
  if (!root) throw new Error("RSS 또는 Atom 형식이 아닙니다.");

  const items = list(root.item || root.entry || doc["rdf:RDF"]?.item)
    .slice(0, 70)
    .map((it: any) => {
      const links = list(it.link);
      const link = str(
        links.find((x: any) => x["@_rel"] === "alternate")?.["@_href"] ||
          links.find((x: any) => x["@_href"])?.["@_href"] ||
          it.link ||
          it.guid,
      );
      let safe = "";
      try {
        const x = new URL(link, u);
        if (["http:", "https:"].includes(x.protocol)) safe = x.href;
      } catch {}
      const date = str(
        it.pubDate || it.published || it.updated || it["dc:date"],
      );
      return {
        title: plain(it.title).slice(0, 1000),
        description:
          [
            it.description,
            it.summary,
            it["content:encoded"],
            it.content,
            it["media:description"],
            it["media:group"]?.["media:description"],
          ]
            .map(plain)
            .find(Boolean)
            ?.slice(0, 500) || "",
        link: safe,
        date: Number.isNaN(Date.parse(date))
          ? null
          : new Date(date).toISOString(),
      };
    })
    .filter(
      (x: any) =>
        x.title && x.link && x.link.length <= 4000 && isRecentFeedArticle(x),
    );

  return {
    title: plain(root.title),
    items,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  try {
    const rawUrl = new URL(req.url).searchParams.get("url") || "";
    if (!rawUrl) {
      return Response.json({ error: "피드 URL이 누락되었습니다." }, { status: 400 });
    }

    const u = valid(rawUrl);
    const cacheKey = u.href;
    const now = Date.now();

    // 1. 메모리 캐시 확인 (3분 유효)
    const cached = feedCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return Response.json(
        { title: cached.title, items: cached.items, updatedAt: cached.updatedAt },
        { headers: { "Cache-Control": "public, max-age=180" } }
      );
    }

    // 2. 동시 요청 중복 방지 (In-flight Promise deduplication)
    let fetchPromise = pendingFetches.get(cacheKey);
    if (!fetchPromise) {
      fetchPromise = fetchAndParseFeed(u);
      pendingFetches.set(cacheKey, fetchPromise);
    }

    try {
      const feedData = await fetchPromise;

      // 캐시 크기 관리 (최대 300개 유지)
      if (feedCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = feedCache.keys().next().value;
        if (oldestKey) feedCache.delete(oldestKey);
      }

      feedCache.set(cacheKey, {
        ...feedData,
        expiresAt: now + CACHE_TTL_MS,
      });

      return Response.json(feedData, {
        headers: { "Cache-Control": "public, max-age=180" },
      });
    } catch (fetchErr) {
      // 3. 일시적 수집 오류 시 30분 이내 stale 캐시가 있으면 안전하게 반환
      if (cached && now - (cached.expiresAt - CACHE_TTL_MS) < STALE_TTL_MS) {
        return Response.json(
          { title: cached.title, items: cached.items, updatedAt: cached.updatedAt, stale: true },
          { headers: { "Cache-Control": "public, max-age=60" } }
        );
      }
      throw fetchErr;
    } finally {
      pendingFetches.delete(cacheKey);
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "피드를 가져오지 못했습니다." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
