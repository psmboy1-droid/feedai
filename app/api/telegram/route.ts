import { NextResponse } from 'next/server';
import { db } from '@/db';
import { userSettings } from '@/db/schema';

const botToken = process.env.TELEGRAM_BOT_TOKEN;

// 텔레그램 메시지 발송 전용 함수 (Cloudflare 완벽 호환)
async function sendTelegramMessage(chatId: number | string, text: string) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
        }),
    });
}

export async function POST(req: Request) {
    try {
        if (!botToken) {
            throw new Error("TELEGRAM_BOT_TOKEN 환경변수가 없습니다.");
        }

        // ✅ `: any`를 붙여서 타입스크립트 에러 완벽 해결
        const body: any = await req.json();
        const message = body?.message;

        // 일반 텍스트 메시지가 아니면 무시하고 정상 종료
        if (!message || !message.text) {
            return NextResponse.json({ success: true });
        }

        const text: string = message.text.trim();
        const chatId = message.chat.id;
        const username = message.from?.first_name || '사용자';

        // '/start' 명령어가 들어왔을 때 처리
        if (text.startsWith('/start')) {
            // '/start 유저ID' 형태에서 유저ID(payload) 추출
            const parts = text.split(/\s+/);
            const userId = parts.length > 1 ? parts[1] : '';

            if (userId) {
                try {
                    await db.insert(userSettings)
                        .values({ 
                            userId: String(userId), 
                            telegramChatId: String(chatId) 
                        })
                        .onConflictDoUpdate({
                            target: userSettings.userId,
                            set: { telegramChatId: String(chatId) }
                        });

                    console.log(`\n🎉 [DB 연동 성공] User: ${userId}, Chat ID: ${chatId}`);
                    await sendTelegramMessage(
                        chatId,
                        `TELE-DESK 채널 연동이 완료되었습니다.\n${username}님, 실시간 맞춤 브리핑을 수신할 준비가 되었습니다. 🚀`
                    );
                } catch (dbError) {
                    console.error('DB 저장 에러:', dbError);
                    await sendTelegramMessage(
                        chatId,
                        `DB 연동 중 오류가 발생했습니다. 다시 시도해 주세요.`
                    );
                }
            } else {
                await sendTelegramMessage(
                    chatId,
                    `텔레그램 연동은 웹페이지의 '연동하기' 버튼을 통해서만 가능합니다.`
                );
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('텔레그램 웹훅 에러:', error);
        return NextResponse.json({ success: false, error: 'Webhook Handler Failed' }, { status: 500 });
    }
}