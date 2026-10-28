// 🚀 48시간(2일) 제한을 30일로 넉넉하게 늘려 예전 SNS 글도 다 가져오게 합니다.
export const FEED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; 

export function isRecentFeedArticle(article: { date: string | null }, now = Date.now()): boolean {
  // 🚀 SNS RSS 특성상 날짜(date)가 누락되어 들어오는 경우, 버리지 말고 무조건 통과시킵니다.
  if (!article.date) return true; 
  
  const publishedAt = Date.parse(article.date);
  return Number.isFinite(publishedAt) && publishedAt >= now - FEED_WINDOW_MS && publishedAt <= now;
}