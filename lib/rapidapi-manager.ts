import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

// 5분 신선 캐시, 1시간 백업 캐시
const memoryCache = new Map<string, CacheEntry<any>>();
const CACHE_FRESH_MS = 5 * 60 * 1000;
const CACHE_STALE_MS = 60 * 60 * 1000;

// 라운드로빈 인덱스 및 쿨다운 관리
let currentKeyIndex = 0;
const keyCooldowns = new Map<string, number>();
const COOLDOWN_MS = 30 * 60 * 1000; // 429/403 발생 시 30분 쿨다운

export function getRapidApiKeys(): string[] {
    const raw = [
        process.env.RAPIDAPI_KEY_1,
        process.env.RAPIDAPI_KEY_2,
        process.env.RAPIDAPI_KEY_3,
        process.env.RAPIDAPI_KEY_4,
        process.env.RAPIDAPI_KEY,
    ];
    return Array.from(new Set(raw.filter((k): k is string => Boolean(k && k.trim()))));
}

function maskKey(key: string): string {
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '...' + key.slice(-4);
}

export async function fetchRapidApiWithRotation<T = any>(
    serviceName: string,
    cacheKey: string,
    requestBuilder: (key: string) => AxiosRequestConfig
): Promise<{ data: T; fromCache?: boolean; isStale?: boolean }> {
    const now = Date.now();

    // 1. 신선 캐시 확인 (5분 이내 요청이면 RapidAPI 호출 없이 즉각 응답)
    const cached = memoryCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < CACHE_FRESH_MS) {
        console.log(`[RapidAPI:${serviceName}] ⚡ 5분 신선 캐시 적중: ${cacheKey}`);
        return { data: cached.data, fromCache: true };
    }

    const keys = getRapidApiKeys();
    if (keys.length === 0) {
        if (cached) {
            console.warn(`[RapidAPI:${serviceName}] ⚠️ 설정된 API 키 없음. 보관 캐시 반환`);
            return { data: cached.data, fromCache: true, isStale: true };
        }
        throw new Error('RapidAPI 키가 환경 변수에 설정되지 않았습니다.');
    }

    // 2. 가용 키 라운드로빈 분산 (한 키만 먼저 닳지 않고 4개 계정에 균등 분산)
    const startIndex = currentKeyIndex % keys.length;
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;

    const orderedIndices = keys.map((_, i) => (startIndex + i) % keys.length);
    let lastError: any = null;

    for (const idx of orderedIndices) {
        const key = keys[idx];
        const cooldownUntil = keyCooldowns.get(key) || 0;

        // 쿨다운(한도 초과 등) 중인 키는 건강한 다른 키가 있다면 건너뜀
        if (cooldownUntil > now && orderedIndices.length > 1) {
            const remainSec = Math.round((cooldownUntil - now) / 1000);
            console.log(`[RapidAPI:${serviceName}] ⏳ 키 #${idx + 1}(${maskKey(key)}) 쿨다운 중 (${remainSec}초 잔여) - 다음 키로 즉시 패스`);
            continue;
        }

        try {
            console.log(`[RapidAPI:${serviceName}] 🔄 키 #${idx + 1}(${maskKey(key)})로 접속 시도 중...`);
            const config = requestBuilder(key);
            // 🚀 핵심: 타임아웃을 기존 30초에서 6초로 단축하여 지연 폭증 방지!
            config.timeout = config.timeout || 6000;
            config.headers = {
                ...config.headers,
                'x-rapidapi-key': key,
            };

            const response: AxiosResponse<T> = await axios(config);
            console.log(`[RapidAPI:${serviceName}] ✅ 키 #${idx + 1} 데이터 획득 성공!`);

            // 성공 시 캐시 갱신 및 쿨다운 해제
            memoryCache.set(cacheKey, { data: response.data, timestamp: Date.now() });
            keyCooldowns.delete(key);

            return { data: response.data };
        } catch (err: any) {
            lastError = err;
            const status = err.response?.status;
            console.error(`[RapidAPI:${serviceName}] ⚠️ 키 #${idx + 1} 실패 (HTTP ${status || err.message})`);

            // 429(Rate Limit) 또는 403(Quota Exceeded)인 경우 30분 쿨다운 등록
            if (status === 429 || status === 403) {
                keyCooldowns.set(key, now + COOLDOWN_MS);
                console.warn(`[RapidAPI:${serviceName}] 🚫 키 #${idx + 1} 30분 쿨다운 등록 (일일 한도 초과 감지)`);
            }
        }
    }

    // 3. 만약 4개 키가 일시적으로 모두 소진된 경우에도 직전 1시간 내 캐시가 있다면 오류 대신 표시!
    if (cached && (now - cached.timestamp) < CACHE_STALE_MS) {
        console.warn(`[RapidAPI:${serviceName}] 🚨 모든 키 실패 -> 보관된 이전 캐시로 안전 반환 (${cacheKey})`);
        return { data: cached.data, fromCache: true, isStale: true };
    }

    throw lastError || new Error(`RapidAPI ${serviceName} 요청 실패`);
}

