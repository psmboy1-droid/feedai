import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayIso = today.toISOString();

        // 1. 가입자 통계 (전체 가입자 및 오늘 신규 가입)
        const { data: usersData } = await supabase.auth.admin.listUsers();
        const totalUsers = usersData?.users?.length || 0;
        const todayNewUsers = usersData?.users?.filter(user => new Date(user.created_at) >= today).length || 0;

        // 2. 트래픽 통계 (오늘 방문자 및 누적 총 방문자)
        const { count: todayVisits } = await supabase
            .from('visit_logs')
            .select('*', { count: 'exact', head: true })
            .gte('visited_at', todayIso);

        const { count: totalVisits } = await supabase
            .from('visit_logs')
            .select('*', { count: 'exact', head: true });

        return NextResponse.json({
            todayVisitors: todayVisits || 0,
            totalVisits: totalVisits || 0,
            todayNewUsers,
            totalUsers
        });

    } catch (error) {
        return NextResponse.json({ error: '대시보드 데이터를 불러오지 못했습니다.' }, { status: 500 });
    }
}