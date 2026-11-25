import { NextRequest, NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { isRssAdmin } from '@/lib/rss-admin';
import { getSupabaseServer } from '@/lib/supabase';
import { isSameOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        // 1. 로그인 확인
        const user = await getChatGPTUser();
        if (!user || !user.userId) {
            return reply({ error: '로그인 후 추천할 수 있습니다.' }, 401);
        }

        // 2. CSRF Same-Origin 검증
        if (!isSameOrigin(req)) {
            return reply({ error: '허용되지 않은 요청입니다.' }, 403);
        }

        const supabase = getSupabaseServer();
        const isAdmin = await isRssAdmin();

        // 3. 게시글 존재 및 비밀글 권한 확인
        const { data: post, error: findError } = await supabase
            .from('community_posts')
            .select('is_secret, author_id')
            .eq('id', id)
            .maybeSingle();

        if (findError || !post) {
            return reply({ error: '게시글을 찾을 수 없습니다.' }, 404);
        }

        if (post.is_secret && !isAdmin && post.author_id !== user.userId) {
            return reply({ error: '비밀글에는 추천할 수 없습니다.' }, 403);
        }

        // 4. 추천 여부 확인 (토글)
        const { data: existingLike } = await supabase
            .from('community_likes')
            .select('*')
            .eq('post_id', id)
            .eq('user_id', user.userId)
            .maybeSingle();

        let liked = false;
        if (existingLike) {
            // 이미 추천한 경우 취소
            await supabase
                .from('community_likes')
                .delete()
                .eq('post_id', id)
                .eq('user_id', user.userId);
            liked = false;
        } else {
            // 새로 추천
            await supabase
                .from('community_likes')
                .insert([{
                    post_id: id,
                    user_id: user.userId,
                }]);
            liked = true;
        }

        // 5. 정확한 count로 like_count 동기화
        const { count: exactLikes } = await supabase
            .from('community_likes')
            .select('*', { count: 'exact', head: true })
            .eq('post_id', id);

        const newCount = exactLikes ?? 0;
        await supabase
            .from('community_posts')
            .update({ like_count: newCount })
            .eq('id', id);

        return reply({
            liked,
            likeCount: newCount,
            message: liked ? '게시글을 추천했습니다.' : '추천을 취소했습니다.',
        });
    } catch (err) {
        console.error('추천 토글 처리 에러:', err);
        return reply({ error: '추천 처리 중 오류가 발생했습니다.' }, 500);
    }
}
