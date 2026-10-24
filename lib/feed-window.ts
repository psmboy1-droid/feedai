export const FEED_WINDOW_MS = 48 * 60 * 60 * 1000;

export function isRecentFeedArticle(article: { date: string | null }, now = Date.now()): boolean {
  if (!article.date) return false;
  const publishedAt = Date.parse(article.date);
  return Number.isFinite(publishedAt) && publishedAt >= now - FEED_WINDOW_MS && publishedAt <= now;
}
