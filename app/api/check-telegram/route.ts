import { NextResponse } from 'next/server';
import { db } from '@/db';
import { userSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ success: false });
        }

        // DB에서 해당 유저의 텔레그램 Chat ID 조회
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