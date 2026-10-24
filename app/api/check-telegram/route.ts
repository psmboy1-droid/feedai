import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { userSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ success: false });
        }

        const db = getDb(); // ✅ 새 DB 연결 방식 적용
        
        const result = await db
            .select({ telegramChatId: userSettings.telegramChatId })
            .from(userSettings)
            .where(eq(userSettings.userId, String(userId)))
            .limit(1);

        const chatId = result[0]?.telegramChatId;

        if (chatId) {
            return NextResponse.json({ success: true, chatId });
        } else {
            return NextResponse.json({ success: false });
        }
    } catch (error) {
        console.error('텔레그램 연동 확인 에러:', error);
        return NextResponse.json({ success: false }, { status: 500 });
    }
}