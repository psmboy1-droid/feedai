import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json() as { email: string; password: string };
        const { email, password } = body;

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        // Supabase REST API로 회원가입 요청
        const res = await fetch(`${supabaseUrl}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey as string, // 💡 "이건 무조건 문자열이야!" 라고 강제 명시
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });

        const data = (await res.json()) as {
            error?: string;
            error_description?: string;
            user?: {
                id: string;
                email: string;
            };
        };

        if (!res.ok || data.error) {
            throw new Error(data.error_description || "회원가입에 실패했습니다.");
        }

        return NextResponse.json({ success: true, message: "회원가입이 완료되었습니다!" });

    } catch (error: any) {
        console.error("🚨 회원가입 에러:", error);
        return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    }
}