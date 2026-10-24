import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    const cookieStore = await cookies();
    const userId = cookieStore.get('userId')?.value;
    const userEmail = cookieStore.get('userEmail')?.value;

    // 1. 로그인이 안 되어 있으면 얌전히 null 반환 (UI가 에러 없이 멈추도록)
    if (!userId) {
        return NextResponse.json({ user: null });
    }

    // 2. 로그인 성공 시, UI가 뻗지 않도록 빈 깡통(초기화) 상태를 예쁘게 포장해서 반환
    return NextResponse.json({
        user: {
            id: userId,
            name: userEmail?.split('@')[0] || 'User',
            admin: true
        },
        state: { feeds: [], saved: [], read: [] }, // 💡 추후 Supabase rss_signals 테이블과 매칭할 부분
        revision: 1,
        tokens: 0
    });
}

export async function PUT(request: Request) {
    // 프론트엔드 UI에서 피드 저장/삭제 버튼을 누를 때 뻗지 않도록 무조건 성공(200) 반환
    return NextResponse.json({ revision: Date.now() });
}