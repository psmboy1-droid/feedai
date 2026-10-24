export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const body = await request.json() as {
            feedUrl: string;
            categoryName: string;
            frequency?: string;
            aiPromptCode?: string;
            customPrompt?: string;
        };
        const { feedUrl, categoryName, frequency, aiPromptCode, customPrompt } = body;

        console.log("📥 [TELE-DESK] 새로운 시그널 등록 요청:", body);

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            throw new Error("Supabase 환경변수가 누락되었습니다.");
        }

        // 💡 엔터프라이즈급 대응: 현재 로그인한 유저의 ID를 가져와야 합니다.
        // (현재는 Next.js Auth 연동 전이므로, 테스트 통과를 위해 임시 UUID를 넣습니다. 
        // 나중에 지인분의 로그인 세션 로직과 연결할 때 이 줄만 '실제 유저 ID'로 바꾸면 됩니다!)
        const tempUserId = "temp-user-id-0000"; 

        // 🚀 파트너님의 실제 테이블인 'rss_signals'로 데이터 꽂아넣기!
        const res = await fetch(`${supabaseUrl}/rest/v1/rss_signals`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal' // 응답 속도 최적화 (엔터프라이즈급 설정)
            },
            body: JSON.stringify({
                user_id: tempUserId,
                feed_url: feedUrl,
                category_name: categoryName,
                frequency: frequency || '360',
                target_channel: 'telegram',
                ai_prompt_code: aiPromptCode || 'DEFAULT',
                custom_prompt: customPrompt || '',
                is_active: true
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`DB 저장 실패: ${errorText}`);
        }

        return Response.json({ success: true, message: "시그널이 완벽하게 등록되었습니다." }, { status: 200 });

    } catch (error: any) {
        console.error("🚨 시그널 등록 에러:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
}