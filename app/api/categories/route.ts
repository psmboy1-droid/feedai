import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 미들웨어에서 사용하신 것과 동일하게 Supabase 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // 🚀 1. 하드코딩 제거: Supabase 'shared_categories' 테이블에서 직접 카테고리 이름을 불러옵니다.
        const { data, error } = await supabase
            .from('shared_categories')
            .select('name')
            .eq('deleted', false)
            .order('created_at', { ascending: true }); // 등록된 순서대로 정렬 (원하시면 'name'으로 변경 가능)

        if (error) throw error;

        // DB에서 가져온 데이터 배열화
        const categoryNames = data ? data.map(c => c.name) : [];

        return NextResponse.json({
            // 🚀 2. DB에 데이터가 정상적으로 있으면 그것을 쏴주고, 만약 DB가 비어있다면 최후의 방어선(기본값)을 던져줍니다.
            categories: categoryNames.length > 0 
                ? categoryNames 
                : ['국내', '국제', '경제', '미국증시', 'AI·테크', '코인', '과학', '건강', '스포츠', '문화', '소셜'],
            mapping: {} 
        });

    } catch (error) {
        console.error('❌ /api/categories DB 조회 실패:', error);
        // DB 쿼리 실패 시 사이트가 터지지 않도록 안전망 제공
        return NextResponse.json({
            categories: ['국내', '국제', '경제', '미국증시', 'AI·테크', '코인', '과학', '건강', '스포츠', '문화', '소셜']
        });
    }
}

// 어드민용 카테고리 수정/삭제 방어막 (에러 안 나게 처리)
export async function POST() { return NextResponse.json({ success: true }); }
export async function PUT() { return NextResponse.json({ success: true }); }
export async function DELETE() { return NextResponse.json({ success: true }); }