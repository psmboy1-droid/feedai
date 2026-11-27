/**
 * /api/admin/dopamine/route.ts
 * 도파민 센터 관리자 API — Supabase 기반
 */

import { z } from 'zod';
import { isRssAdmin } from '../../../../lib/rss-admin';
import { getSupabaseServer } from '../../../../lib/supabase';
import { collectTrending, collectAll, type Platform, type Country } from '../../../../lib/dopamine-collector';
import { getR2StorageStats, deleteFromR2ByUrl, extractR2KeyFromUrl } from '../../../../lib/r2';
import { isSameOrigin } from '../../../../lib/csrf';

export const dynamic = 'force-dynamic';

const PLATFORMS: Platform[] = ['youtube', 'tiktok', 'instagram'];
const COUNTRIES: Country[]  = ['KR', 'US', 'JP'];

const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function payload(req: Request) {
    const raw = await req.text();
    if (raw.length > 10000) throw new Error('입력 용량이 너무 큽니다.');
    return JSON.parse(raw);
}

async function allowed(req: Request) {
    if (!await isRssAdmin()) return reply({ error: '관리자만 접근할 수 있습니다.' }, 403);
    if (req.method !== 'GET' && !isSameOrigin(req))
        return reply({ error: '허용되지 않은 요청입니다.' }, 403);
    return null;
}

// ─── Zod 스키마 ───────────────────────────────────────────────
const platformEnum   = z.enum(['youtube', 'tiktok', 'instagram']);
const countryEnum    = z.enum(['KR', 'US', 'JP']);
const countryAllEnum = z.enum(['KR', 'US', 'JP', 'ALL']);

// 빈 문자열도 허용하는 URL-or-empty 타입
const urlOrEmpty = z.union([z.literal(''), z.string().url()]);

const settingsSchema = z.object({
    platform:        platformEnum,
    country:         countryEnum,
    search_keyword:  z.string().trim().min(1).max(200),
    display_limit:   z.number().int().min(1).max(100),
});

const collectSchema = z.object({
    action:   z.literal('collect'),
    platform: platformEnum.optional(),
    country:  countryEnum.optional(),
});

const createAdSchema = z.object({
    action:        z.literal('create_ad'),
    platform:      platformEnum,
    country:       countryAllEnum,
    slot_position: z.number().int().min(1),
    media_type:    z.enum(['image', 'video']),
    title:         z.string().trim().min(1).max(200),
    media_url:     z.string().url(),
    thumbnail_url: urlOrEmpty.optional().default(''),
    link_url:      z.string().url(),
    is_active:     z.boolean().default(true),
});

const patchAdSchema = z.object({
    id:            z.string().uuid(),
    platform:      platformEnum.optional(),
    country:       countryAllEnum.optional(),
    slot_position: z.number().int().min(1).optional(),
    media_type:    z.enum(['image', 'video']).optional(),
    title:         z.string().trim().min(1).max(200).optional(),
    media_url:     z.string().url().optional(),
    thumbnail_url: urlOrEmpty.optional(),
    link_url:      z.string().url().optional(),
    is_active:     z.boolean().optional(),
});

const deleteAdSchema = z.object({ id: z.string().uuid() });

// ─── 헬퍼: 다른 광고에서 URL 참조 여부 확인 ──────────────────────────────
async function isUrlReferencedByOtherAds(
    supabase: ReturnType<typeof getSupabaseServer>,
    url: string,
    excludeId: string
): Promise<boolean> {
    if (!url) return false;
    const { data } = await supabase
        .from('dopamine_ads')
        .select('id')
        .or(`media_url.eq.${url},thumbnail_url.eq.${url}`)
        .neq('id', excludeId)
        .limit(1);
    return (data?.length ?? 0) > 0;
}

// ─── GET ─────────────────────────────────────────────────────
export async function GET(req: Request) {
    const denied = await allowed(req);
    if (denied) return denied;

    const supabase = getSupabaseServer();

    const [settingsRes, adsRes, storage] = await Promise.all([
        supabase.from('dopamine_settings').select('*').order('platform').order('country'),
        supabase.from('dopamine_ads').select('*').order('platform').order('slot_position'),
        getR2StorageStats(supabase),
    ]);

    // 플랫폼 × 국가별 현재 저장된 영상 수
    const videoCountMap: Record<string, number> = {};
    for (const p of PLATFORMS) {
        for (const c of COUNTRIES) {
            const { count } = await supabase
                .from('trending_videos')
                .select('id', { count: 'exact', head: true })
                .eq('platform', p)
                .eq('country', c);
            videoCountMap[`${p}_${c}`] = count ?? 0;
        }
    }

    return reply({
        settings:    settingsRes.data  ?? [],
        ads:         adsRes.data       ?? [],
        videoCounts: videoCountMap,
        storage,
    });
}

// ─── PUT (설정 저장) ──────────────────────────────────────────
export async function PUT(req: Request) {
    const denied = await allowed(req);
    if (denied) return denied;

    try {
        const body = settingsSchema.parse(await payload(req));
        const supabase = getSupabaseServer();

        const { error } = await supabase.from('dopamine_settings').upsert(
            { ...body, updated_at: new Date().toISOString() },
            { onConflict: 'platform,country' }
        );
        if (error) return reply({ error: error.message }, 500);

        return reply({ message: '설정을 저장했습니다.' });
    } catch (e) {
        return reply({ error: e instanceof z.ZodError ? '입력값을 확인해 주세요.' : (e as Error).message }, 400);
    }
}

// ─── POST (수집 실행 / 광고 추가) ────────────────────────────
export async function POST(req: Request) {
    const denied = await allowed(req);
    if (denied) return denied;

    try {
        const body = await payload(req);

        // 광고 추가
        if (body.action === 'create_ad') {
            const d = createAdSchema.parse(body);
            const supabase = getSupabaseServer();
            const { error } = await supabase.from('dopamine_ads').insert({
                platform:      d.platform,
                country:       d.country,
                slot_position: d.slot_position,
                media_type:    d.media_type,
                title:         d.title,
                media_url:     d.media_url,
                thumbnail_url: d.thumbnail_url,
                link_url:      d.link_url,
                is_active:     d.is_active,
                created_at:    new Date().toISOString(),
                updated_at:    new Date().toISOString(),
            });
            if (error) return reply({ error: error.message }, 500);
            return reply({ message: '광고를 등록했습니다.' }, 201);
        }

        // 수집 실행
        if (body.action === 'collect') {
            const d = collectSchema.parse(body);
            const deadlineAt = Date.now() + 75_000;

            if (d.platform && d.country) {
                const result = await collectTrending(d.platform, d.country, { deadlineAt });
                if (result.error && result.count === 0) {
                    console.error('[Dopamine Admin] collect failed:', d.platform, d.country, result.error);
                    return reply({ error: result.error }, 422);
                }
                const message = result.partial
                    ? `수집 완료: ${result.count}건 (시간 제한으로 완료 항목만 안전 반영)`
                    : `수집 완료: ${result.count}건`;
                return reply({ message, count: result.count, partial: result.partial ?? false });
            }

            const results = await collectAll({ deadlineAt });
            const totalCount = results.reduce((s, r) => s + r.count, 0);
            return reply({ message: `전체 수집 완료: ${totalCount}건`, results });
        }

        return reply({ error: '알 수 없는 action입니다.' }, 400);
    } catch (e) {
        return reply({ error: e instanceof z.ZodError ? '입력값을 확인해 주세요.' : (e as Error).message }, 400);
    }
}

// ─── PATCH (광고 수정) ────────────────────────────────────────
export async function PATCH(req: Request) {
    const denied = await allowed(req);
    if (denied) return denied;

    try {
        const { id, ...updates } = patchAdSchema.parse(await payload(req));
        const supabase = getSupabaseServer();

        // 수정 전 기존 URL 조회 (R2 정리용)
        const { data: existing } = await supabase
            .from('dopamine_ads')
            .select('media_url, thumbnail_url')
            .eq('id', id)
            .maybeSingle();

        const { error } = await supabase
            .from('dopamine_ads')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) return reply({ error: error.message }, 500);

        // 변경된 URL에서 R2 파일 정리 (다른 광고에서 미참조 시에만)
        if (existing) {
            const urlsToCheck: Array<{ old: string; newer?: string }> = [
                { old: existing.media_url,      newer: updates.media_url },
                { old: existing.thumbnail_url,  newer: updates.thumbnail_url },
            ];
            for (const { old, newer } of urlsToCheck) {
                if (old && newer !== undefined && newer !== old && extractR2KeyFromUrl(old)) {
                    const referenced = await isUrlReferencedByOtherAds(supabase, old, id);
                    if (!referenced) {
                        await deleteFromR2ByUrl(supabase, old).catch(() => {});
                    }
                }
            }
        }

        return reply({ message: '광고를 수정했습니다.' });
    } catch (e) {
        return reply({ error: e instanceof z.ZodError ? '입력값을 확인해 주세요.' : (e as Error).message }, 400);
    }
}

// ─── DELETE (광고 삭제) ──────────────────────────────────────
export async function DELETE(req: Request) {
    const denied = await allowed(req);
    if (denied) return denied;

    try {
        const { id } = deleteAdSchema.parse(await payload(req));
        const supabase = getSupabaseServer();

        // 삭제 전 URL 조회
        const { data: existing } = await supabase
            .from('dopamine_ads')
            .select('media_url, thumbnail_url')
            .eq('id', id)
            .maybeSingle();

        const { error } = await supabase.from('dopamine_ads').delete().eq('id', id);
        if (error) return reply({ error: error.message }, 500);

        // DB 삭제 성공 후 R2 파일 정리 (다른 광고에서 미참조 시에만)
        if (existing) {
            for (const url of [existing.media_url, existing.thumbnail_url]) {
                if (url && extractR2KeyFromUrl(url)) {
                    // id가 이미 삭제됐으므로 모든 광고 기준으로 조회
                    const { data: refs } = await supabase
                        .from('dopamine_ads')
                        .select('id')
                        .or(`media_url.eq.${url},thumbnail_url.eq.${url}`)
                        .limit(1);
                    if (!refs?.length) {
                        await deleteFromR2ByUrl(supabase, url).catch(() => {});
                    }
                }
            }
        }

        return reply({ message: '광고를 삭제했습니다.' });
    } catch (e) {
        return reply({ error: e instanceof z.ZodError ? '입력값을 확인해 주세요.' : (e as Error).message }, 400);
    }
}
