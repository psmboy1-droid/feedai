import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const botToken = process.env.TELEGRAM_BOT_TOKEN;

const ManualSaveSchema = z.object({
    userId: z.string().min(1),
    chatId: z.string().optional().default(''),
});

// 텔레그램 메시지 발송 전용 함수
async function sendTelegramMessage(chatId: number | string, text: string) {
    if (!botToken) return;
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
        const body: any = await req.json();

        // 🚀 1. 화면 모달에서 [설정 저장] 버튼을 눌러 Chat ID를 직접 저장할 때
        if ('userId' in body && !('message' in body)) {
            const parsed = ManualSaveSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json({ success: false, error: '잘못된 입력값입니다.' }, { status: 400 });
            }
            const { userId, chatId } = parsed.data;
            const cleanChatId = chatId.trim();

            const { error } = await supabase
                .from('user_settings')
                .upsert(
                    { user_id: String(userId), telegram_chat_id: cleanChatId || null },
                    { onConflict: 'user_id' }
                );

            if (error) throw error;
            return NextResponse.json({ success: true, chatId: cleanChatId });
        }

        // 🚀 2. 텔레그램 앱에서 [시작(/start)] 버튼을 눌렀을 때 (1초 자동 연동)
        if (!botToken) {
            throw new Error('TELEGRAM_BOT_TOKEN 환경변수가 없습니다.');
        }

        const message = body?.message;
        if (!message || !message.text) {
            return NextResponse.json({ success: true });
        }

        const text: string = message.text.trim();
        const chatId = message.chat.id;
        const username = message.from?.first_name || '사용자';

        if (text.startsWith('/start')) {
            const parts = text.split(/\s+/);
            const userId = parts.length > 1 ? parts[1] : '';

            if (userId) {
                try {
                    const { error } = await supabase
                        .from('user_settings')
                        .upsert(
                            {
                                user_id: String(userId),
                                telegram_chat_id: String(chatId),
                            },
                            { onConflict: 'user_id' }
                        );

                    if (error) throw error;

                    console.log(`\n🎉 [DB 연동 성공] User: ${userId}, Chat ID: ${chatId}`);
                    await sendTelegramMessage(
                        chatId,
                        `피드AI 채널 연동이 완료되었습니다.\n${username}님, 실시간 맞춤 브리핑을 수신할 준비가 되었습니다. 🚀`
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
    } catch (error: any) {
        console.error('텔레그램 웹훅 에러:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Webhook Handler Failed' },
            { status: 500 }
        );
    }
}