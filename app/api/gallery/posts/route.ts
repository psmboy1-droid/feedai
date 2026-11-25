import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { isRssAdmin } from '@/lib/rss-admin';
import { getSupabaseServer } from '@/lib/supabase';
import { isValidGalleryCategory } from '@/lib/gallery-config';
import { isSameOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

const postSchema = z.object({
    title: z.string().trim().min(1, '제목을 입력해 주세요.').max(150, '제목은 150자 이내여야 합니다.'),
    category: z.string().refine(isValidGalleryCategory, '올바른 카테고리를 선택해 주세요.'),
    content: z.string().trim().max(2000, '설명은 2000자 이내여야 합니다.').optional().default(''),
    image_urls: z
        .array(z.string().url('올바른 이미지 URL이 아닙니다.'))
        .min(1, '이미지는 최소 1장 이상 첨부해야 합니다.')
        .max(5, '이미지는 최대 5장까지 첨부할 수 있습니다.'),
});

function calcHotScore(post: { like_count?: number; comment_count?: number; view_count?: number }): number {
    return (post.like_count || 0) * 5 + (post.comment_count || 0) * 3 + (post.view_count || 0) * 1;
}

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const tabParam = url.searchParams.get('tab') || 'all';
        const tab = tabParam === 'hot' ? 'hot' : 'all';
        const rawCategory = url.searchParams.get('category') || 'all';
        const categoryFilter = rawCategory !== 'all' && isValidGalleryCategory(rawCategory) ? rawCategory : 'all';
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
        const limit = Math.min(40, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));

        const user = await getChatGPTUser();
        const isAdmin = await isRssAdmin();
        const supabase = getSupabaseServer();

        let posts: any[] = [];
        let total = 0;

        if (tab === 'hot') {
            // ─── HOT 탭: 최근 7일 우선 + 20개 미만 시 전체 기간 보완 (상위 20개) ────────
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

            let recentQuery = supabase
                .from('gallery_posts')
                .select('*')
                .gte('created_at', sevenDaysAgo);

            if (categoryFilter !== 'all') {
                recentQuery = recentQuery.eq('category', categoryFilter);
            }
            if (q) {
                recentQuery = recentQuery.or(`title.ilike.%${q}%,content.ilike.%${q}%`);
            }

            const { data: recentData, error: recentErr } = await recentQuery;
            if (recentErr) {
                console.error('갤러리 HOT 조회 에러:', recentErr.message);
                return reply({ error: '갤러리 목록을 불러오지 못했습니다.' }, 500);
            }

            const scoredRecent = (recentData || [])
                .map((p: any) => ({ ...p, hot_score: calcHotScore(p) }))
                .sort((a: any, b: any) => b.hot_score - a.hot_score);

            if (scoredRecent.length >= 20) {
                posts = scoredRecent.slice(0, 20);
                total = scoredRecent.length;
            } else {
                const existingIds = new Set(scoredRecent.map((p: any) => p.id));
                let allTimeQuery = supabase
                    .from('gallery_posts')
                    .select('*')
                    .order('like_count', { ascending: false })
                    .limit(100);

                if (categoryFilter !== 'all') {
                    allTimeQuery = allTimeQuery.eq('category', categoryFilter);
                }
                if (q) {
                    allTimeQuery = allTimeQuery.or(`title.ilike.%${q}%,content.ilike.%${q}%`);
                }

                const { data: allTimeData, error: allErr } = await allTimeQuery;
                if (allErr) {
                    console.error('갤러리 HOT 전체기간 조회 에러:', allErr.message);
                    return reply({ error: '갤러리 목록을 불러오지 못했습니다.' }, 500);
                }

                const moreScored = (allTimeData || [])
                    .filter((p: any) => !existingIds.has(p.id))
                    .map((p: any) => ({ ...p, hot_score: calcHotScore(p) }))
                    .sort((a: any, b: any) => b.hot_score - a.hot_score);

                posts = [...scoredRecent, ...moreScored].slice(0, 20);
                total = posts.length;
            }
        } else {
            // ─── 전체(ALL) 탭: 최신순 페이지네이션 ───────────────────────────────
            const from = (page - 1) * limit;
            const to = from + limit - 1;

            let query = supabase
                .from('gallery_posts')
                .select('*', { count: 'exact' });

            if (categoryFilter !== 'all') {
                query = query.eq('category', categoryFilter);
            }
            if (q) {
                query = query.or(`title.ilike.%${q}%,content.ilike.%${q}%`);
            }

            query = query
                .order('created_at', { ascending: false })
                .range(from, to);

            const { data, count, error } = await query;
            if (error) {
                console.error('갤러리 목록 조회 에러:', error.message);
                return reply({ error: '갤러리 목록을 불러오지 못했습니다.' }, 500);
            }

            posts = data || [];
            total = count || 0;
        }

        // ─── 로그인 유저 좋아요 여부 조회 ─────────────────────────────────────────
        let likedPostIds: string[] = [];
        if (user?.userId && posts.length > 0) {
            const postIds = posts.map((p: any) => p.id);
            const { data: likes } = await supabase
                .from('gallery_likes')
                .select('post_id')
                .eq('user_id', user.userId)
                .in('post_id', postIds);

            likedPostIds = (likes || []).map((l: any) => l.post_id);
        }

        return reply({
            posts,
            total,
            page,
            limit,
            likedPostIds,
            currentUserId: user?.userId || null,
            isAdmin,
        });
    } catch (err) {
        console.error('갤러리 목록 처리 에러:', err);
        return reply({ error: '갤러리 목록을 불러오는 중 오류가 발생했습니다.' }, 500);
    }
}

export async function POST(req: NextRequest) {
    try {
        // 1. 회원 로그인 확인
        const user = await getChatGPTUser();
        if (!user || !user.userId) {
            return reply({ error: '로그인 후 글을 작성할 수 있습니다.' }, 401);
        }

        // 2. CSRF Same-Origin 검증
        if (!isSameOrigin(req)) {
            return reply({ error: '허용되지 않은 요청입니다.' }, 403);
        }

        // 3. 입력값 검증 (Zod)
        let bodyJson: unknown;
        try {
            bodyJson = await req.json();
        } catch {
            return reply({ error: '잘못된 입력 형식입니다.' }, 400);
        }

        const parsed = postSchema.safeParse(bodyJson);
        if (!parsed.success) {
            const firstErr = parsed.error.issues[0]?.message || '입력값을 확인해 주세요.';
            return reply({ error: firstErr }, 400);
        }

        const d = parsed.data;

        // 4. R2 이미지 URL 유효성 검사
        const r2PublicUrl = (process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
        if (r2PublicUrl) {
            for (const imgUrl of d.image_urls) {
                if (!imgUrl.startsWith(r2PublicUrl + '/')) {
                    return reply({ error: '첨부 이미지는 FeedAI 업로더를 통해 업로드된 파일만 등록할 수 있습니다.' }, 400);
                }
            }
        }

        const supabase = getSupabaseServer();

        // 5. 작성자 이름 조회 (profiles 테이블 우선, 세션 메타데이터 fallback)
        const { data: profile } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', user.userId)
            .maybeSingle();

        const authorName = profile?.name || user.displayName || user.email?.split('@')[0] || '익명 회원';

        // 6. DB 저장
        const { data: post, error: insertError } = await supabase
            .from('gallery_posts')
            .insert([{
                category: d.category,
                title: d.title,
                content: d.content,
                image_urls: d.image_urls,
                author_id: user.userId,
                author_name: authorName,
                view_count: 0,
                like_count: 0,
                comment_count: 0,
            }])
            .select()
            .single();

        if (insertError) {
            console.error('갤러리 게시글 등록 실패:', insertError.message);
            return reply({ error: `게시글 등록에 실패했습니다: ${insertError.message}` }, 500);
        }

        return reply({ post, message: '게시글이 등록되었습니다.' }, 201);
    } catch (err) {
        console.error('갤러리 게시글 작성 처리 에러:', err);
        return reply({ error: '게시글 작성 중 오류가 발생했습니다.' }, 500);
    }
}
