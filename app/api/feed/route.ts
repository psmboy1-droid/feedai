import { socialAccount } from "../../../lib/social-parser";
import { socialFeed } from "../../../lib/social-service";
import { getChatGPTUser } from "../../chatgpt-auth";
import { membership } from "../../../lib/membership";
import { isRecentFeedArticle } from "../../../lib/feed-window";
import { sharedFeed } from "../../../lib/shared-feed-cache";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

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

async function loadFeed(req: Request) {
  try {
    let u = valid(new URL(req.url).searchParams.get("url") || "");
    let res: Response | undefined;
    for (let n = 0; n < 4; n++) {
      res = await fetch(u, {
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml",
          "User-Agent": "NewsDesk RSS Reader",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(12000),
      });
      if (res.status >= 300 && res.status < 400) {
        u = valid(new URL(res.headers.get("location") || "", u).href);
        continue;
      }
      break;
    }
    if (!res?.ok)
      throw new Error(`피드 응답 오류 (${res?.status || "연결 실패"})`);
    const reader = res.body?.getReader();
    if (!reader) throw Error("빈 피드입니다.");
    let xml = "",
      bytes = 0;
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
    return Response.json(
      { title: plain(root.title), items, updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "피드를 가져오지 못했습니다." },
      { status: 400 },
    );
  }
}

export async function GET(req:Request){
  try {
    return await loadFeed(req);
  } catch(e) {
    return Response.json({error:e instanceof Error?e.message:'피드 수집 실패'},{status:503});
  }
}