import { NextRequest, NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
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
            return reply({ error: '로그인 후 좋아요를 누를 수 있습니다.' }, 401);
        }

        // 2. CSRF Same-Origin 검증
        if (!isSameOrigin(req)) {
            return reply({ error: '허용되지 않은 요청입니다.' }, 403);
        }

        const supabase = getSupabaseServer();

        // 3. 게시글 존재 확인
        const { data: post, error: findError } = await supabase
            .from('gallery_posts')
            .select('id')
            .eq('id', id)
            .maybeSingle();

        if (findError || !post) {
            return reply({ error: '게시글을 찾을 수 없습니다.' }, 404);
        }

        // 4. 좋아요 여부 확인 (토글)
        const { data: existingLike } = await supabase
            .from('gallery_likes')
            .select('post_id')
            .eq('post_id', id)
            .eq('user_id', user.userId)
            .maybeSingle();

        let liked = false;
        if (existingLike) {
            await supabase
                .from('gallery_likes')
                .delete()
                .eq('post_id', id)
                .eq('user_id', user.userId);
            liked = false;
        } else {
            await supabase
                .from('gallery_likes')
                .insert([{
                    post_id: id,
                    user_id: user.userId,
                }]);
            liked = true;
        }

        // 5. 정확한 count로 like_count 동기화
        const { count: exactLikes } = await supabase
            .from('gallery_likes')
            .select('*', { count: 'exact', head: true })
            .eq('post_id', id);

        const like_count = exactLikes ?? 0;
        await supabase
            .from('gallery_posts')
            .update({ like_count })
            .eq('id', id);

        return reply({
            liked,
            like_count,
        });
    } catch (err) {
        console.error('갤러리 좋아요 토글 에러:', err);
        return reply({ error: '좋아요 처리 중 오류가 발생했습니다.' }, 500);
    }
}
