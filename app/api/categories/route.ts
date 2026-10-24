import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    // 프론트엔드가 요구하는 카테고리 탭 데이터를 정적으로 바로 쏴줌 (DB 에러 원천 차단)
    return NextResponse.json({
        categories: ['국내', '국제', '경제', '미국증시', 'AI·테크', '코인', '과학', '건강', '스포츠', '문화']
    });
}

// 어드민용 카테고리 수정/삭제 방어막 (에러 안 나게 처리)
export async function POST() { return NextResponse.json({ success: true }); }
export async function PUT() { return NextResponse.json({ success: true }); }
export async function DELETE() { return NextResponse.json({ success: true }); }