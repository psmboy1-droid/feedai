import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { isRssAdmin } from '@/lib/rss-admin';
import { getSupabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

const postSchema = z.object({
    board_type: z.enum(['free', 'suggestions']),
    title: z.string().trim().min(1, '제목을 입력해 주세요.').max(150, '제목은 150자 이내여야 합니다.'),
    content: z.string().trim().min(1, '내용을 입력해 주세요.').max(10000, '내용은 10000자 이내여야 합니다.'),
    image_urls: z.array(z.string().url()).max(5, '이미지는 최대 5장까지 첨부할 수 있습니다.').default([]),
    video_url: z.string().url().startsWith('https://').nullable().optional().or(z.literal('')),
    is_secret: z.boolean().default(false),
    is_notice: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const board = url.searchParams.get('board') || 'free';
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100);

        const user = await getChatGPTUser();
        const isAdmin = await isRssAdmin();
        const supabase = getSupabaseServer();

        let rawPosts: any[] = [];
        let total = 0;

        if (board === 'hot') {
            // ─── HOT 게시판: 자유게시판(free) 글 중 인기 점수 산출 ─────────────────
            // 인기 점수 공식 = like_count * 5 + comment_count * 3 + view_count * 1
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

            let recentQuery = supabase
                .from('community_posts')
                .select('*')
                .eq('board_type', 'free')
                .gte('created_at', sevenDaysAgo);

            if (q) {
                recentQuery = recentQuery.or(`title.ilike.%${q}%,content.ilike.%${q}%`);
            }

            const { data: recentData } = await recentQuery;

            const scoredRecent = (recentData || []).map((p: any) => ({
                ...p,
                hot_score: (p.like_count || 0) * 5 + (p.comment_count || 0) * 3 + (p.view_count || 0) * 1,
            })).sort((a: any, b: any) => b.hot_score - a.hot_score);

            if (scoredRecent.length >= 20) {
                rawPosts = scoredRecent.slice(0, 20);
                total = scoredRecent.length;
            } else {
                // 7일 이내 글이 20개 미만이면 전체 기간 자유게시판 글에서 중복 제외하고 보완
                const existingIds = new Set(scoredRecent.map((p: any) => p.id));
                let allTimeQuery = supabase
                    .from('community_posts')
                    .select('*')
                    .eq('board_type', 'free')
                    .order('like_count', { ascending: false })
                    .limit(100);

                if (q) {
                    allTimeQuery = allTimeQuery.or(`title.ilike.%${q}%,content.ilike.%${q}%`);
                }

                const { data: allTimeData } = await allTimeQuery;

                const moreScored = (allTimeData || [])
                    .filter((p: any) => !existingIds.has(p.id))
                    .map((p: any) => ({
                        ...p,
                        hot_score: (p.like_count || 0) * 5 + (p.comment_count || 0) * 3 + (p.view_count || 0) * 1,
                    }))
                    .sort((a: any, b: any) => b.hot_score - a.hot_score);

                rawPosts = [...scoredRecent, ...moreScored].slice(0, 20);
                total = rawPosts.length;
            }
        } else {
            // ─── 자유게시판(free) / 건의게시판(suggestions) 목록 ─────────────────────
            const pageSize = 20;
            const from = (page - 1) * pageSize;
            const to = from + pageSize - 1;

            let query = supabase
                .from('community_posts')
                .select('*', { count: 'exact' })
                .eq('board_type', board);

            if (q) {
                query = query.or(`title.ilike.%${q}%,content.ilike.%${q}%`);
            }

            query = query
                .order('is_notice', { ascending: false })
                .order('created_at', { ascending: false })
                .range(from, to);

            const { data, count, error } = await query;
            if (error) {
                console.error('게시글 목록 조회 에러:', error.message);
                return reply({ error: '게시글 목록을 불러오지 못했습니다.' }, 500);
            }

            rawPosts = data || [];
            total = count || 0;
        }

        // ─── 비밀글 보호 (작성자 또는 관리자가 아니면 마스킹) ─────────────────────
        const posts = rawPosts.map((p: any) => {
            const isAuthor = user?.userId && p.author_id === user.userId;
            const canView = !p.is_secret || isAdmin || isAuthor;

            if (!canView) {
                return {
                    id: p.id,
                    board_type: p.board_type,
                    title: '비밀글입니다.',
                    author_name: p.author_name,
                    author_id: p.author_id,
                    is_secret: true,
                    is_notice: p.is_notice,
                    status: p.status,
                    view_count: p.view_count,
                    like_count: p.like_count,
                    comment_count: p.comment_count,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                    is_masked: true,
                };
            }

            return {
                ...p,
                is_masked: false,
            };
        });

        return reply({
            posts,
            total,
            page,
            pageSize: 20,
            currentUserId: user?.userId || null,
            isAdmin,
        });
    } catch (err) {
        console.error('커뮤니티 글 목록 처리 에러:', err);
        return reply({ error: '게시글 목록을 불러오는 중 오류가 발생했습니다.' }, 500);
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
        const origin = req.headers.get('origin');
        const reqOrigin = new URL(req.url).origin;
        if (origin !== reqOrigin) {
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

        // 4. R2 이미지 URL 유효성 검사 (반드시 FeedAI R2_PUBLIC_URL 로 시작해야 함)
        const r2PublicUrl = (process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
        if (r2PublicUrl && d.image_urls.length > 0) {
            for (const imgUrl of d.image_urls) {
                if (!imgUrl.startsWith(r2PublicUrl + '/')) {
                    return reply({ error: '첨부 이미지는 FeedAI 업로더를 통해 업로드된 파일만 등록할 수 있습니다.' }, 400);
                }
            }
        }

        const isAdmin = await isRssAdmin();
        const supabase = getSupabaseServer();

        // 5. 작성자 이름 조회 (profiles 테이블 우선, 세션 메타데이터 fallback)
        const { data: profile } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', user.userId)
            .maybeSingle();

        const authorName = profile?.name || user.displayName || user.email?.split('@')[0] || '익명 회원';

        // 6. 비밀글 및 공지글 권한 제약 적용
        const isSecret = d.board_type === 'suggestions' ? d.is_secret : false;
        const isNotice = isAdmin ? d.is_notice : false;
        const initialStatus = 'received';

        // 7. 게시글 DB 저장
        const { data: post, error: insertError } = await supabase
            .from('community_posts')
            .insert([{
                board_type: d.board_type,
                title: d.title,
                content: d.content,
                image_urls: d.image_urls,
                video_url: d.video_url || null,
                author_id: user.userId,
                author_name: authorName,
                is_secret: isSecret,
                is_notice: isNotice,
                status: initialStatus,
                view_count: 0,
                like_count: 0,
                comment_count: 0,
            }])
            .select()
            .single();

        if (insertError) {
            console.error('게시글 등록 실패:', insertError.message);
            return reply({ error: `게시글 등록에 실패했습니다: ${insertError.message}` }, 500);
        }

        return reply({ post, message: '게시글이 등록되었습니다.' }, 201);
    } catch (err) {
        console.error('게시글 작성 처리 에러:', err);
        return reply({ error: '게시글 작성 중 오류가 발생했습니다.' }, 500);
    }
}
