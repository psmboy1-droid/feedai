import { membership } from './membership';
import { queuedAi } from './ai-queue';
import { getSupabaseServer } from './supabase';
import { GET as feedRequest } from '../app/api/feed/route';
import { readAiPrompts } from './ai-prompts';
import { resolveApiKey } from './ai-key';
import { analysisPayload } from './analysis-response';
import {
    BRIEF_OUTPUT_FORMAT,
    cleanBrief,
    selectBriefArticles,
    TODAY_BRIEF_PROMPT,
    SUMMARY_THEME_RULE,
    type BriefArticle,
    type BriefSnapshot
} from './today-brief';
import type { Feed } from './news-config';

export const briefCacheMs = 1800000;

export type TodayBriefRow = {
    userId: string;
    feedKey: string;
    requestId: string;
    status: string;
    jobId: string;
    snapshot: string;
    result: string;
    error: string;
    createdAt: string;
    updatedAt: string;
};

export async function accountFeeds(userId: string) {
    try {
        const supabase = getSupabaseServer();
        const { data: row } = await supabase
            .from('news_accounts')
            .select('state')
            .eq('user_id', userId)
            .maybeSingle();

        let feeds: Feed[] = [];
        if (row?.state) {
            try {
                const parsed = typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
                feeds = parsed.feeds || [];
            } catch {}
        }
        const memberInfo = await membership(userId);
        return feeds.slice(0, memberInfo.limits.feeds);
    } catch {
        return [];
    }
}

export async function feedFingerprint(feeds: Feed[]) {
    const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
            JSON.stringify({
                feeds: feeds.map(f => [f.id, f.url]).sort((a, b) => a[0].localeCompare(b[0])),
                prompt: (await readAiPrompts()).summary,
                themeRule: SUMMARY_THEME_RULE
            })
        )
    );
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export async function briefRow(userId: string): Promise<TodayBriefRow | null> {
    try {
        const supabase = getSupabaseServer();
        const { data: row } = await supabase
            .from('today_briefs')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (!row) return null;
        return {
            userId: row.user_id,
            feedKey: row.feed_key,
            requestId: row.request_id,
            status: row.status,
            jobId: row.job_id || '',
            snapshot: row.snapshot || '',
            result: row.result || '',
            error: row.error || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    } catch {
        return null;
    }
}

export async function updateBrief(
    userId: string,
    requestId: string,
    data: Partial<{
        feedKey: string;
        status: string;
        jobId: string;
        snapshot: string;
        result: string;
        error: string;
    }>
) {
    const supabase = getSupabaseServer();
    const updateData: any = { updated_at: new Date().toISOString() };
    if (data.feedKey !== undefined) updateData.feed_key = data.feedKey;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.jobId !== undefined) updateData.job_id = data.jobId;
    if (data.snapshot !== undefined) updateData.snapshot = data.snapshot;
    if (data.result !== undefined) updateData.result = data.result;
    if (data.error !== undefined) updateData.error = data.error;

    const { data: updated } = await supabase
        .from('today_briefs')
        .update(updateData)
        .eq('user_id', userId)
        .eq('request_id', requestId)
        .select();

    return updated || [];
}

export function isBriefFresh(row: TodayBriefRow, key: string) {
    return row.feedKey === key && Date.now() - Date.parse(row.createdAt) < briefCacheMs;
}

export function briefView(row: TodayBriefRow) {
    return {
        status: row.status,
        result: row.result ? JSON.parse(row.result) : null,
        snapshot: row.snapshot ? JSON.parse(row.snapshot) : null,
        createdAt: row.createdAt,
        error: row.error || undefined
    };
}

export async function collectBrief(feeds: Feed[]): Promise<BriefSnapshot> {
    const now = Date.now(),
        deadline = now + 20000,
        items: Omit<BriefArticle, 'id'>[] = [],
        failedFeeds: string[] = [];
    for (let i = 0; i < feeds.length; i += 8) {
        if (Date.now() > deadline) {
            failedFeeds.push(...feeds.slice(i).map(f => f.name));
            break;
        }
        await Promise.all(
            feeds.slice(i, i + 8).map(async f => {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    const timeout = new Promise<never>((_, reject) => {
                        timer = setTimeout(() => reject(Error('timeout')), 10000);
                    });
                    const response = await Promise.race([
                        feedRequest(new Request('https://feedman.invalid/api/feed?url=' + encodeURIComponent(f.url))),
                        timeout
                    ]);
                    const d = (await response.json()) as {
                        items?: { title: string; description: string; link: string; date: string | null }[];
                    };
                    if (!response.ok || !Array.isArray(d.items)) throw Error('feed');
                    items.push(
                        ...d.items.map(a => ({
                            title: a.title.slice(0, 1000),
                            description: a.description.slice(0, 1200),
                            link: a.link,
                            date: a.date || '',
                            source: f.name,
                            feedId: f.id
                        }))
                    );
                } catch {
                    failedFeeds.push(f.name);
                } finally {
                    if (timer) clearTimeout(timer);
                }
            })
        );
    }
    return {
        ...selectBriefArticles(items, now),
        feedCount: feeds.length,
        failedFeeds,
        windowStart: new Date(now - 86400000).toISOString(),
        windowEnd: new Date(now).toISOString()
    };
}

export async function summaryApi(owner: string, path: string, body?: unknown) {
    return analysisPayload(await queuedAi(owner, path, body));
}

export async function startSummary(owner: string, snapshot: BriefSnapshot) {
    return summaryApi(owner, '', {
        model: process.env.OPENAI_ANALYSIS_MODEL || 'gpt-5.4',
        background: true,
        store: true,
        max_output_tokens: 16000,
        reasoning: { effort: 'low' },
        text: { format: BRIEF_OUTPUT_FORMAT },
        instructions:
            (await readAiPrompts()).summary +
            '\n\n' +
            SUMMARY_THEME_RULE +
            '\n각 주제 설명은 간결하게 작성한다. overview, markets, stocks, watchpoints는 각각 최대 8개로 제한한다. 각 주제의 articleIds는 실제 입력 ID만 사용하며 최대 120개다. 문자열 길이는 6000자, ticker는 40자, market은 100자 이하로 작성한다. 중요도는 0~100 정수다.\n\n시스템 출력 형식 (우선 적용):\n' +
            TODAY_BRIEF_PROMPT.slice(TODAY_BRIEF_PROMPT.indexOf('반드시 아래 JSON')),
        input: JSON.stringify({
            analysisTimeKST: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
            windowStart: snapshot.windowStart,
            windowEnd: snapshot.windowEnd,
            articles: snapshot.articles
        })
    });
}

export function completedBrief(text: string, snapshot: BriefSnapshot) {
    return JSON.stringify(cleanBrief(text, snapshot));
}
