import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';
import OpenAI from 'openai';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// 서버리스 환경 충돌을 막기 위해 가벼운 REST API 방식(fetch)으로 텔레그램을 조작합니다.
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 이미지(enclosure)까지 싹 긁어오도록 파서 옵션 강화
const parser = new Parser({
    customFields: { item: ['enclosure', 'content', 'contentSnippet'] }
});

const FireSchema = z.object({
    userId: z.string().min(1, '로그인이 필요합니다.'),
    feedUrl: z.string().url('유효한 RSS 주소가 아닙니다.')
});

export async function POST(req: Request) {
    try {
        if (!botToken || !process.env.OPENAI_API_KEY) {
            throw new Error('서버 환경변수(Telegram Token 또는 OpenAI Key)가 누락되었습니다.');
        }

        const body = await req.json();
        const parsed = FireSchema.safeParse(body);
        
        if (!parsed.success) {
            return NextResponse.json({ success: false, message: parsed.error.issues[0]?.message }, { status: 400 });
        }
        const { userId, feedUrl } = parsed.data;

        // 1. 유저의 텔레그램 Chat ID 가져오기
        const { data: userSetting } = await supabase.from('user_settings').select('telegram_chat_id').eq('user_id', userId).maybeSingle();
        if (!userSetting || !userSetting.telegram_chat_id) {
            return NextResponse.json({ success: false, message: '텔레그램 Chat ID가 연동되지 않았습니다.' });
        }
        const chatId = userSetting.telegram_chat_id;

        // 2. RSS 피드 파싱 (최신 3개만 추출)
        let feed;
        try { feed = await parser.parseURL(feedUrl); } 
        catch (e) { return NextResponse.json({ success: false, message: '피드 URL을 읽을 수 없습니다.' }); }
        
        const topArticles = (feed.items || []).slice(0, 3);
        if (topArticles.length === 0) {
            return NextResponse.json({ success: false, message: '가져올 피드 게시물이 없습니다.' });
        }

        // 3. DB에서 커스텀 프롬프트 및 설정 불러오기
        const { data: signalInfo } = await supabase.from('rss_signals').select('id, category_name, ai_prompt_code, custom_prompt').eq('user_id', userId).eq('feed_url', feedUrl).maybeSingle();
        
        let finalPrompt = '다음 기사 제목을 3줄 요약해 줘.';
        if (signalInfo?.ai_prompt_code === 'CUSTOM' && signalInfo?.custom_prompt) {
            finalPrompt = signalInfo.custom_prompt;
        } else if (signalInfo?.ai_prompt_code) {
            const { data: codeData } = await supabase.from('common_codes').select('ref_value').eq('group_code', 'AI_PROMPT').eq('code_value', signalInfo.ai_prompt_code).maybeSingle();
            if (codeData?.ref_value) finalPrompt = codeData.ref_value;
        }

        // 4. ChatGPT AI 두뇌 가동
        let aiSummary = "AI가 요약본을 생성하는 중 오류가 발생했습니다.";
        try {
            const promptContent = `${finalPrompt}\n\n` + topArticles.map(a => `- ${a.title}`).join('\n');
            const aiResponse = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: promptContent }],
                max_tokens: 300,
                temperature: 0.7
            });
            aiSummary = aiResponse.choices[0].message.content || aiSummary;
        } catch (aiError) { console.error("AI 연결 실패:", aiError); }

        // 5. 텔레그램 메시지 HTML 조립
        const sourceName = signalInfo?.category_name || feed.title || '알림 피드';
        let message = `📰 <b>[AI 인사이트 브리핑] ${sourceName}</b>\n\n💡 <b>AI 리포트</b>\n${aiSummary}\n\n🔗 <b>원문 링크</b>\n`;
        topArticles.forEach((item, index) => { message += `${index + 1}. <a href="${item.link}">${item.title}</a>\n`; });

        // 6. 썸네일 이미지 추출
        let firstImageUrl = null;
        for (const item of topArticles) {
            if (item.enclosure?.url) { firstImageUrl = item.enclosure.url; break; }
            const htmlContent = item.content || item.contentSnippet || '';
            const imgMatch = htmlContent.match(/<img[^>]+src="([^">]+)"/);
            if (imgMatch) { firstImageUrl = imgMatch[1]; break; }
        }

        // 7. 텔레그램 봇 API 다이렉트 호출 (이미지가 있으면 sendPhoto, 없으면 sendMessage)
        try {
            if (firstImageUrl) {
                const captionText = message.length > 1000 ? message.substring(0, 1000) + '...' : message;
                await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, photo: firstImageUrl, caption: captionText, parse_mode: 'HTML' })
                });
            } else {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
                });
            }
        } catch (tgError) {
            return NextResponse.json({ success: false, message: '텔레그램 메시지 발송에 실패했습니다.' });
        }

        // 8. 마지막 발송 시간(last_fired_at) 업데이트
        if (signalInfo?.id) {
            await supabase.from('rss_signals').update({ last_fired_at: new Date().toISOString() }).eq('id', signalInfo.id);
        }

        return NextResponse.json({ success: true, message: 'AI 요약본이 성공적으로 발송되었습니다.' });

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message || '서버 에러가 발생했습니다.' }, { status: 500 });
    }
}