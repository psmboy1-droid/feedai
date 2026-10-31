import { isRecentFeedArticle } from './feed-window';
import { getSupabaseServer } from './supabase';

const pending = new Map<string, Promise<Response>>();
let hotBytes = 0;
const hot = new Map<string, { until: number; payload: string }>();

const response = (payload: string) => {
    const data = JSON.parse(payload);
    if (Array.isArray(data.items))
        data.items = data.items.filter((article: { date: string | null }) => isRecentFeedArticle(article));
    const status = data.__httpStatus || 200;
    delete data.__httpStatus;
    return Response.json(data, { status, headers: { 'Cache-Control': 'private, max-age=60' } });
};

export async function sharedFeed(raw: string, load: () => Promise<Response>, ttl = 300000): Promise<Response> {
    const url = new URL(raw);
    url.hash = '';
    const key = url.href;

    const hit = hot.get(key);
    if (hit && hit.until > Date.now()) return response(hit.payload);

    const existing = pending.get(key);
    if (existing) return (await existing).clone();

    const task = (async () => {
        const supabase = getSupabaseServer();
        const now = Date.now();

        const { data: row } = await supabase
            .from('feed_cache')
            .select('*')
            .eq('url', key)
            .maybeSingle();

        const remember = (payload: string, expires: number) => {
            const previous = hot.get(key);
            if (previous) {
                hotBytes -= previous.payload.length * 2;
                hot.delete(key);
            }
            while (hot.size && (hot.size >= 500 || hotBytes + payload.length * 2 > 8 * 1024 * 1024)) {
                const oldest = hot.keys().next().value!;
                hotBytes -= hot.get(oldest)!.payload.length * 2;
                hot.delete(oldest);
            }
            hotBytes += payload.length * 2;
            hot.set(key, { payload, until: Math.min(expires, Date.now() + 60000) });
            return response(payload);
        };

        if (row?.payload && (row.expires_at || 0) > now) return remember(row.payload, row.expires_at);

        const lock = crypto.randomUUID();
        await supabase.from('feed_cache').upsert({
            url: key,
            lock_id: lock,
            lock_until: now + 60000
        });

        try {
            const result = await load();
            if (!result.ok) {
                if (row?.payload && (row.expires_at || 0) > now - 1800000) {
                    await supabase
                        .from('feed_cache')
                        .update({ expires_at: now + 30000, lock_until: 0 })
                        .eq('url', key);
                    return remember(row.payload, now + 30000);
                }
                const payload = JSON.stringify({
                    ...((await result.json()) as Record<string, unknown>),
                    __httpStatus: result.status
                });
                await supabase
                    .from('feed_cache')
                    .update({ payload, expires_at: now + 30000, lock_until: 0 })
                    .eq('url', key);
                return remember(payload, now + 30000);
            }
            const payload = await result.text();
            const expires = Date.now() + ttl;
            await supabase
                .from('feed_cache')
                .update({ payload, expires_at: expires, lock_until: 0 })
                .eq('url', key);
            return remember(payload, expires);
        } finally {
            await supabase
                .from('feed_cache')
                .update({ lock_until: 0 })
                .eq('url', key);
        }
    })();

    pending.set(key, task);
    try {
        return (await task).clone();
    } finally {
        pending.delete(key);
    }
}
