export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // .env 파일에 있는 Supabase 정보 가져오기
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            throw new Error("Supabase 환경변수가 없습니다.");
        }

        // 💡 Drizzle의 I/O 충돌 버그를 우회하기 위해 가장 안정적인 순수 fetch(REST API) 방식을 사용합니다!
        const res = await fetch(`${supabaseUrl}/rest/v1/common_codes?select=code_value,display_name,tier,group_code&order=sort_order.asc`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            },
            // Cloudflare 환경에서 캐시 문제 방지
            cache: 'no-store'
        });

        if (!res.ok) {
            throw new Error("Supabase REST API 호출 실패");
        }

        const data: any = await res.json();

        // 가져온 데이터를 group_code 별로 분류해서 예쁘게 포장합니다.
        const frequencies = data.filter((item: any) => item.group_code === 'FREQUENCY');
        const prompts = data.filter((item: any) => item.group_code === 'AI_PROMPT');

        return Response.json({
            frequencies,
            prompts
        }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
        
    } catch (error) {
        console.error("🚨 공통 코드 조회 에러:", error);
        
        // 통신 에러 시 프론트엔드가 멈추지 않도록 최소한의 기본값 전송
        return Response.json({
            frequencies: [{ code_value: '360', display_name: '6시간 간격' }],
            prompts: [
                { code_value: 'DEFAULT', display_name: '✨ 기본 3줄 인사이트 요약' },
                { code_value: 'CUSTOM', display_name: '나만의 커스텀 명령 (PRO)' }
            ]
        }, { status: 200 });
    }
}