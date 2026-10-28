import { isRssAdmin, isAdminEmail } from '../../../../lib/rss-admin';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });

const input = z.object({
    plan: z.enum(['free', 'basic', 'pro']).optional(),
    expiresAt: z.string().max(40).optional(),
    userId: z.string().min(1).max(500),
    revision: z.number().int().nonnegative(),
    originalTokens: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(100),
    tokens: z.number().int().min(0).max(1000000)
});

export async function GET(req: Request) {
    if (!await isRssAdmin()) return reply({ error: '관리자만 접근할 수 있습니다.' }, 403);

    try {
        const p = new URL(req.url).searchParams;
        const q = (p.get('q') || '').trim().toLowerCase().slice(0, 100);
        const page = Number(p.get('page') || 1);
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return reply({ error: '잘못된 페이지입니다.' }, 400);

        const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
        if (authError) throw authError;

        const { data: profilesData, error: profilesError } = await supabase.from('profiles').select('*');
        if (profilesError) throw profilesError;

        const user = await getChatGPTUser();

        let members = authData.users.map(authUser => {
            const profile = profilesData.find(p => p.id === authUser.id) || {};
            const name = authUser.user_metadata?.name || authUser.email?.split('@')[0] || '이름 미등록';
            return {
                id: authUser.id,
                name: name,
                email: authUser.email || '',
                plan: profile.tier || 'free',
                expiresAt: profile.expires_at || null,
                tokens: profile.tokens || 0,
                revision: profile.revision || 0,
                createdAt: authUser.created_at,
                updatedAt: authUser.updated_at || authUser.created_at,
                feedCount: profile.ai_usage_count || 0,
                isAdmin: profile.is_admin === true
            };
        });

        if (q) {
            members = members.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.id.includes(q));
        }

        members.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const total = members.length;
        const paginatedMembers = members.slice((page - 1) * 25, page * 25);

        return reply({
            members: paginatedMembers,
            total: total,
            page,
            pageSize: 25,
            currentUserId: user?.userId,
            adminEmail: user?.email || ''
        });
    } catch {
        return reply({ error: '회원 목록을 불러오지 못했습니다.' }, 503);
    }
}

async function body(req: Request) {
    const raw = await req.text();
    if (raw.length > 4000) return null;
    try { return input.safeParse(JSON.parse(raw)); } catch { return null; }
}

// 💡 수정된 부분: 데이터가 없으면 Insert, 있으면 Update (이름도 변경 반영)
export async function PUT(req: Request) {
    if (!await isRssAdmin()) return reply({ error: '관리자만 접근할 수 있습니다.' }, 403);
    if (req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: '허용되지 않은 요청입니다.' }, 403);

    try {
        const parsed = await body(req);
        if (!parsed?.success) return reply({ error: '이름과 크레딧 수(0~1,000,000개)를 확인해 주세요.' }, 400);
        
        const d = parsed.data;
        const plan = d.plan || 'free';
        if (plan !== 'free' && (!d.expiresAt || !Number.isFinite(Date.parse(d.expiresAt)) || Date.parse(d.expiresAt) <= Date.now())) {
            return reply({ error: '유료 요금제의 유효한 이용 종료일을 입력해 주세요.' }, 400);
        }

        // 1. 회원 이름 변경 반영 (수파베이스 Auth 시스템)
        if (d.name) {
            await supabase.auth.admin.updateUserById(d.userId, {
                user_metadata: { name: d.name }
            });
        }

        // 2. profiles 테이블 조회 및 동시성 제어
        const { data: existingProfile } = await supabase.from('profiles').select('revision').eq('id', d.userId).single();
        
        if (existingProfile) {
            // 기존 데이터가 있으면 수정 (Update)
            if (existingProfile.revision !== d.revision) {
                return reply({ error: '회원 정보가 변경되었습니다. 목록을 새로고침하고 다시 수정해 주세요.' }, 409);
            }
            const { error } = await supabase.from('profiles').update({
                tier: plan,
                expires_at: plan === 'free' ? null : d.expiresAt,
                tokens: d.tokens,
                revision: d.revision + 1
            }).eq('id', d.userId);
            if (error) throw error;
        } else {
            // 데이터가 없으면 새로 생성 (Insert) - 껍데기만 있던 회원의 실데이터 생성
            const { error } = await supabase.from('profiles').insert({
                id: d.userId,
                tier: plan,
                expires_at: plan === 'free' ? null : d.expiresAt,
                tokens: d.tokens,
                revision: 1
            });
            if (error) throw error;
        }

        return reply({ message: '회원 정보를 성공적으로 저장했습니다.' });
    } catch (error) {
        console.error('회원 수정 실패:', error);
        return reply({ error: '회원 정보를 저장하지 못했습니다.' }, 503);
    }
}

export async function DELETE(req: Request) {
    if (!await isRssAdmin()) return reply({ error: '관리자만 접근할 수 있습니다.' }, 403);
    if (req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: '허용되지 않은 요청입니다.' }, 403);

    try {
        const parsed = await body(req);
        if (!parsed?.success) return reply({ error: '잘못된 회원 정보입니다.' }, 400);
        
        const d = parsed.data;
        const user = await getChatGPTUser();
        
        if (d.userId === user?.userId) return reply({ error: '현재 관리자 계정은 삭제할 수 없습니다.' }, 400);

        await Promise.all([
            supabase.from('profiles').delete().eq('id', d.userId),
            supabase.from('today_briefs').delete().eq('user_id', d.userId),
            supabase.from('analysis_requests').delete().eq('user_id', d.userId),
            supabase.from('ai_queue').update({ status: 'cancelled' }).eq('owner', d.userId),
            supabase.auth.admin.deleteUser(d.userId)
        ]);

        return reply({ message: '회원을 삭제했습니다. 개인 피드·저장 기록·분석 기록을 제거하고 이 계정의 재등록을 제한했습니다.' });
    } catch {
        return reply({ error: '회원을 삭제하지 못했습니다.' }, 503);
    }
}