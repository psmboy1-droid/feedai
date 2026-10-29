import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const parser = new Parser({ customFields: { item: ['enclosure', 'content', 'contentSnippet'] } });

export async function GET(req: Request) {
    // 💡 보안: 외부에서 아무나 이 주소를 눌러서 AI 요금 폭탄을 맞지 않도록 비밀키를 검사합니다.
    const { searchParams } = new URL(req.url);
    if (searchParams.get('key') !== process.env.CRON_SECRET) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        // 활성화된 시그널 정보와 유저의 텔레그램 연동 정보를 조인해서 한 번에 가져옵니다.
        const { data: signals, error } = await supabase
            .from('rss_signals')
            .select(`*, user_settings ( telegram_chat_id )`)
            .eq('is_active', true);
            
        if (error || !signals) throw new Error('DB 조회 실패');

        // 프롬프트 공통코드 캐싱 (빠른 속도를 위해)
        const { data: prompts } = await supabase.from('common_codes').select('code_value, ref_value').eq('group_code', 'AI_PROMPT');
        const promptMap: Record<string, string> = {};
        if (prompts) prompts.forEach(p => promptMap[p.code_value] = p.ref_value);

        const now = new Date();

        for (const sig of signals) {
            // 조인된 데이터에서 안전하게 chatId 추출 (any 캐스팅 사용)
            const settings = sig.user_settings as any;
            const chatId = settings?.telegram_chat_id || settings?.[0]?.telegram_chat_id;
            if (!chatId) continue;

            const freqMins = parseInt(sig.frequency, 10) || 360; 
            const lastFired = sig.last_fired_at ? new Date(sig.last_fired_at) : new Date(0);
            
            // 설정된 주기가 안 지났으면 패스
            if ((now.getTime() - lastFired.getTime()) / 60000 < freqMins) continue;

            try {
                const feed = await parser.parseURL(sig.feed_url);
                const topArticles = (feed.items || []).slice(0, 3);
                if (topArticles.length === 0) continue;

                const basePrompt = promptMap[sig.ai_prompt_code] || promptMap['DEFAULT'];
                const finalPrompt = (sig.ai_prompt_code === 'CUSTOM' && sig.custom_prompt) ? sig.custom_prompt : basePrompt;
                
                let aiSummary = "AI 요약본 생성 실패";
                try {
                    const promptContent = `${finalPrompt}\n\n` + topArticles.map(a => `- ${a.title}`).join('\n');
                    const aiResponse = await openai.chat.completions.create({
                        model: "gpt-4o-mini",
                        messages: [{ role: "user", content: promptContent }],
                        max_tokens: 300,
                        temperature: 0.7
                    });
                    aiSummary = aiResponse.choices[0].message.content || aiSummary;
                } catch (e) {}

                const sourceName = sig.category_name || feed.title;
                let message = `📰 <b>[AI 자동 브리핑] ${sourceName}</b>\n\n💡 <b>AI 리포트</b>\n${aiSummary}\n\n🔗 <b>원문 링크</b>\n`;
                topArticles.forEach((item, idx) => message += `${idx + 1}. <a href="${item.link}">${item.title}</a>\n`);

                let firstImageUrl = null;
                for (const item of topArticles) {
                    if (item.enclosure?.url) { firstImageUrl = item.enclosure.url; break; }
                    const imgMatch = (item.content || '').match(/<img[^>]+src="([^">]+)"/);
                    if (imgMatch) { firstImageUrl = imgMatch[1]; break; }
                }

                if (firstImageUrl) {
                    const captionText = message.length > 1000 ? message.substring(0, 1000) + '...' : message;
                    await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, photo: firstImageUrl, caption: captionText, parse_mode: 'HTML' })
                    });
                } else {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
                    });
                }

                // 성공 시 발송 시간 업데이트
                await supabase.from('rss_signals').update({ last_fired_at: now.toISOString() }).eq('id', sig.id);

            } catch (parseError) {
                console.error(`피드 파싱 실패: ${sig.feed_url}`);
            }
        }
        
        return NextResponse.json({ success: true, message: '스케줄 점검 완료' });
    } catch (e: any) {
        console.error('[Cron Error]', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}