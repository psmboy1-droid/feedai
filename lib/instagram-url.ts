/**
 * lib/instagram-url.ts
 * 인스타그램 게시물 URL / shortcode 변환 및 서명 URL(oe 파라미터) 만료 판별 유틸
 */

const INSTAGRAM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function divmod64(digits: string): [string, number] {
  let rem = 0;
  let quotient = '';
  for (let i = 0; i < digits.length; i++) {
    const cur = rem * 10 + parseInt(digits[i], 10);
    const q = Math.floor(cur / 64);
    rem = cur % 64;
    if (quotient || q) quotient += q;
  }
  return [quotient || '0', rem];
}

export function extractInstagramRawPk(videoId: string): string {
  return (videoId || '').split('_')[0].trim();
}

export function instagramPkToShortcode(pk: string): string {
  if (!/^\d+$/.test(pk) || pk === '0') return '';
  let digits = pk;
  let code = '';
  while (digits !== '0' && digits !== '') {
    const [q, r] = divmod64(digits);
    code = INSTAGRAM_CHARS[r] + code;
    digits = q;
  }
  return code;
}

export function instagramPostUrl(videoId: string): string {
  const rawPk = extractInstagramRawPk(videoId);
  const shortcode = instagramPkToShortcode(rawPk);
  if (!shortcode) return 'https://www.instagram.com/';
  return `https://www.instagram.com/reel/${shortcode}/`;
}

/**
 * 인스타그램 서명 CDN URL의 쿼리 파라미터 `oe`(16진수 Unix 초) 파싱
 */
export function parseInstagramUrlOeSeconds(url: string): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const oe = parsed.searchParams.get('oe');
    if (!oe || !/^[0-9a-fA-F]{1,16}$/.test(oe)) return null;
    const sec = parseInt(oe, 16);
    if (!Number.isSafeInteger(sec) || sec <= 0) return null;
    return sec;
  } catch {
    return null;
  }
}

/**
 * `oe` 만료 시각이 현재로부터 최소 `minRemainingSeconds`(기본 300초=5분) 이상 남았는지 확인
 */
export function isInstagramOeValid(url: string, minRemainingSeconds = 300): boolean {
  const oeSeconds = parseInstagramUrlOeSeconds(url);
  if (oeSeconds === null) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return oeSeconds - nowSeconds >= minRemainingSeconds;
}

/**
 * 기존 전환 과도기에 DB에 남아 있을 수 있는 R2 `.mp4` URL 판별
 */
export function isLegacyInstagramR2Mp4Url(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host.includes('instagram.com') ||
      host.includes('cdninstagram.com') ||
      host.includes('fbcdn.net')
    ) {
      return false;
    }
    return parsed.pathname.includes('/dopamine/instagram/') && /\.mp4$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
