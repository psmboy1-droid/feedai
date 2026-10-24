import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json() as { email: string; password: string };
        const { email, password } = body;

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            throw new Error("Supabase 환경변수가 없습니다.");
        }

        // 1. Supabase REST API로 로그인 검증
        const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });

        const data = await res.json() as {
            error?: string;
            error_description?: string;
            user?: {
                id: string;
                email: string;
            };
        };

        if (!res.ok || data.error || !data.user) { // 💡 !data.user 추가!
            throw new Error(data.error_description || "로그인에 실패했습니다. (유저 정보 없음)");
        }

        // 2. 🚀 엔터프라이즈급 보안 쿠키 굽기 (기존 res.cookie의 상위 호환)
        const cookieStore = await cookies();
        
        // 브라우저 해킹(XSS)을 원천 차단하는 HttpOnly 옵션 적용
        cookieStore.set('userId', data.user.id, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/' 
        });
        
        cookieStore.set('userEmail', data.user.email, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/' 
        });

        return NextResponse.json({ success: true, message: "로그인 성공", user: data.user });

    } catch (error: any) {
        console.error("🚨 로그인 에러:", error);
        return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }
}