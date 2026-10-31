import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase';
import { getChatGPTUser } from '../../chatgpt-auth';
import Parser from 'rss-parser';
import OpenAI from 'openai';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const parser = new Parser({
    customFields: { item: ['enclosure', 'content', 'contentSnippet', 'description'] }
});

const FireSchema = z.object({
    userId: z.string().optional(),
    feedUrl: z.string().min(1, '유효한 RSS 주소가 아닙니다.')
});

function extractCleanBody(item: any): string {
    const raw = item.contentSnippet || item.content || item.description || '';
    return raw
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>?/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 350);
}

export async function POST(req: Request) {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const apiKey = process.env.OPENAI_API_KEY;

        if (!botToken || !apiKey) {
            throw new Error('서버 환경변수(Telegram Token 또는 OpenAI Key)가 누락되었습니다.');
        }

        const openai = new OpenAI({ apiKey });
        const user = await getChatGPTUser();
        const body = await req.json().catch(() => ({}));
        const parsed = FireSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ success: false, message: parsed.error.issues[0]?.message }, { status: 400 });
        }

        const userId = user?.userId || parsed.data.userId;
        const { feedUrl } = parsed.data;

        if (!userId) {
            return NextResponse.json({ success: false, message: '로그인이 필요합니다.' }, { status: 401 });
        }

        const supabase = getSupabaseServer();

        // 1. 유저의 텔레그램 Chat ID 가져오기
        const { data: userSetting } = await supabase
            .from('user_settings')
            .select('telegram_chat_id')
            .eq('user_id', userId)
            .maybeSingle();

        if (!userSetting || !userSetting.telegram_chat_id) {
            return NextResponse.json({
                success: false,
                message: '텔레그램 연동이 필요합니다. 먼저 [알림 채널 연동]을 완료해 주세요.'
            });
        }
        const chatId = userSetting.telegram_chat_id;

        // 2. RSS 피드 파싱
        let feed;
        try {
            feed = await parser.parseURL(feedUrl);
        } catch (e) {
            return NextResponse.json({ success: false, message: '피드 URL을 읽을 수 없습니다. 주소를 확인해 주세요.' });
        }

        const allItems = feed.items || [];
        if (allItems.length === 0) {
            return NextResponse.json({ success: false, message: '가져올 피드 게시물이 없습니다.' });
        }

        // 3. DB에서 시그널 정보 및 발송 히스토리(last_fired_at) 불러오기
        const { data: signalInfo } = await supabase
            .from('rss_signals')
            .select('id, category_name, ai_prompt_code, custom_prompt, last_fired_at')
            .eq('user_id', userId)
            .eq('feed_url', feedUrl)
            .maybeSingle();

        // 4. 발송 건수 설정 확인 (기본 3개, 관리자 설정 연동)
        let maxArticles = 3;
        try {
            const { data: countCode } = await supabase
                .from('common_codes')
                .select('ref_value')
                .eq('group_code', 'SYSTEM_CONFIG')
                .eq('code_value', 'DISPATCH_ARTICLE_COUNT')
                .maybeSingle();
            if (countCode?.ref_value) {
                const parsedNum = parseInt(countCode.ref_value, 10);
                if (parsedNum > 0 && parsedNum <= 20) maxArticles = parsedNum;
            }
        } catch {}

        // 마지막 발송 이후의 신규 글 필터링
        const lastFiredDate = signalInfo?.last_fired_at ? new Date(signalInfo.last_fired_at) : new Date(0);
        const unreadItems = allItems.filter(item => {
            const pubDate = item.isoDate || item.pubDate;
            if (!pubDate) return true;
            return new Date(pubDate).getTime() > lastFiredDate.getTime();
        });

        const isFresh = unreadItems.length > 0;
        const topArticles = (isFresh ? unreadItems : allItems).slice(0, maxArticles);

        let finalPrompt = '다음 게시물들의 제목과 본문을 읽고 핵심 내용을 전체 3줄로 요약해 줘.';
        if (signalInfo?.ai_prompt_code === 'CUSTOM' && signalInfo?.custom_prompt) {
            finalPrompt = signalInfo.custom_prompt;
        } else if (signalInfo?.ai_prompt_code) {
            const { data: codeData } = await supabase
                .from('common_codes')
                .select('ref_value')
                .eq('group_code', 'AI_PROMPT')
                .eq('code_value', signalInfo.ai_prompt_code)
                .maybeSingle();
            if (codeData?.ref_value) finalPrompt = codeData.ref_value;
        }

        // 5. OpenAI 요약 생성
        let aiSummary = 'AI가 요약본을 생성하는 중 오류가 발생했습니다.';
        try {
            const articlesText = topArticles
                .map((a, idx) => {
                    const bodyText = extractCleanBody(a);
                    return `[게시물 ${idx + 1}]\n제목: ${a.title || '제목 없음'}\n본문: ${bodyText || '내용 없음'}`;
                })
                .join('\n\n');

            const promptContent = `${finalPrompt}\n\n${articlesText}`;
            const aiResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: promptContent }],
                max_tokens: 400,
                temperature: 0.5
            });
            aiSummary = aiResponse.choices[0].message.content || aiSummary;
        } catch (aiError) {
            console.error('AI 연결 실패:', aiError);
        }

        // 6. 텔레그램 메시지 HTML 조립
        const sourceName = signalInfo?.category_name || feed.title || '알림 피드';
        const freshNotice = isFresh ? '' : '<i>(마지막 발송 이후 신규 글이 없어 최신 게시물 기준으로 요약합니다)</i>\n\n';
        let message = `📰 <b>[AI 인사이트 브리핑] ${sourceName} (${topArticles.length}건)</b>\n${freshNotice}💡 <b>AI 리포트</b>\n${aiSummary}\n\n🔗 <b>원문 링크</b>\n`;
        topArticles.forEach((item, index) => {
            message += `${index + 1}. <a href="${item.link}">${item.title}</a>\n`;
        });

        // 7. 썸네일 이미지 추출
        let firstImageUrl = null;
        for (const item of topArticles) {
            if (item.enclosure?.url) {
                firstImageUrl = item.enclosure.url;
                break;
            }
            const htmlContent = (item as any).content || (item as any).description || item.contentSnippet || '';
            const imgMatch = htmlContent.match(/<img[^>]+src="([^">]+)"/);
            if (imgMatch) {
                firstImageUrl = imgMatch[1];
                break;
            }
        }

        // 8. 텔레그램 발송
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

        // 9. 마지막 발송 시간(last_fired_at) 업데이트
        if (signalInfo?.id) {
            await supabase
                .from('rss_signals')
                .update({ last_fired_at: new Date().toISOString() })
                .eq('id', signalInfo.id);
        }

        return NextResponse.json({
            success: true,
            message: `텔레그램으로 ${topArticles.length}건의 AI 브리핑이 성공적으로 발송되었습니다.`,
            sentCount: topArticles.length
        });

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message || '서버 에러가 발생했습니다.' }, { status: 500 });
    }
}
