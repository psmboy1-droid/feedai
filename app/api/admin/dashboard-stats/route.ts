import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../../lib/supabase';
import { isRssAdmin } from '../../../../lib/rss-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // 관리자 권한 확인 (Supabase profiles.is_admin 검증)
        const isAdmin = await isRssAdmin();
        if (!isAdmin) {
            return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
        }

        const supabase = getSupabaseServer();

        // 한국시간(KST, UTC+9) 00:00:00 기준 시각 (UTC ISO 변환)
        const now = new Date();
        const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const todayKstStr = kstNow.toISOString().slice(0, 10);
        const kstMidnightIso = new Date(`${todayKstStr}T00:00:00+09:00`).toISOString();
        const kstMidnightDate = new Date(kstMidnightIso);

        // 1. 가입자 통계 (perPage: 1000으로 전체 페이지 순회)
        let page = 1;
        let totalUsers = 0;
        let todayNewUsers = 0;
        const perPage = 1000;

        while (true) {
            const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({
                page,
                perPage,
            });

            if (usersError || !usersData?.users || usersData.users.length === 0) {
                break;
            }

            const users = usersData.users;
            totalUsers += users.length;

            for (const user of users) {
                if (user.created_at && new Date(user.created_at) >= kstMidnightDate) {
                    todayNewUsers++;
                }
            }

            if (users.length < perPage) {
                break;
            }
            page++;
            if (page > 100) break; // 안전 가드
        }

        // 2. 트래픽 통계 (오늘 방문자 및 누적 총 방문자)
        const { count: todayVisits } = await supabase
            .from('visit_logs')
            .select('*', { count: 'exact', head: true })
            .gte('visited_at', kstMidnightIso);

        const { count: totalVisits } = await supabase
            .from('visit_logs')
            .select('*', { count: 'exact', head: true });

        return NextResponse.json({
            todayVisitors: todayVisits || 0,
            totalVisits: totalVisits || 0,
            todayNewUsers,
            totalUsers,
        });

    } catch (error) {
        console.error('대시보드 통계 조회 실패:', error);
        return NextResponse.json({ error: '대시보드 데이터를 불러오지 못했습니다.' }, { status: 500 });
    }
}
