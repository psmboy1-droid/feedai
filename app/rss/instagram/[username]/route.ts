import RSS from 'rss';
import { fetchRapidApiWithRotation } from '../../../../lib/rapidapi-manager';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { username: string } }) {
    const username = params.username;
    const host = request.headers.get('host') || 'feedaix.com';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';

    const feed = new RSS({
        title: `[피드AI] ${username} 님의 인스타그램`,
        description: '피드AI 자체 생성 인스타그램 RSS 피드',
        feed_url: `${protocol}://${host}/rss/instagram/${username}`,
        site_url: `https://instagram.com/${username}`
    });

    let posts: any = [];
    let fetchSuccess = false;

    try {
        const result = await fetchRapidApiWithRotation(
            'Instagram',
            `instagram:${username.toLowerCase()}`,
            () => ({
                method: 'POST',
                url: 'https://instagram-scraper-stable-api.p.rapidapi.com/get_ig_user_posts.php',
                data: { username, username_or_url: username },
                headers: {
                    'Content-Type': 'multipart/form-data',
                    'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com'
                },
                timeout: 6000 // 6초 빠른 타임아웃
            })
        );

        fetchSuccess = true;
        posts = result.data?.posts || result.data?.data?.items || result.data || [];
    } catch (err: any) {
        console.error(`🚨 [인스타그램 RSS] 모든 키 요청 실패:`, err.message);
    }

    if (fetchSuccess) {
        const postArray = Array.isArray(posts) ? posts : (posts.items || []);
        if (postArray.length > 0) {
            postArray.forEach((item: any) => {
                const node = item.node || item; 
                const mediaUrl = node.display_url || node.thumbnail_src || (node.image_versions2?.candidates?.[0]?.url) || '';
                const rawText = node.edge_media_to_caption?.edges?.[0]?.node?.text || node.caption?.text || node.text || "게시물 이미지/영상";
                const safeTitle = Array.from(rawText).slice(0, 30).join('').replace(/\0/g, '') + '...';
                const postCode = node.shortcode || node.code || '';

                feed.item({
                    title: safeTitle,
                    description: `<img src="${mediaUrl}" style="max-width:400px; border-radius:8px;"><br><br><p>${rawText}</p>`,
                    url: postCode ? `https://instagram.com/p/${postCode}/` : `https://instagram.com/${username}`,
                    date: new Date((node.taken_at_timestamp || node.taken_at || Date.now()/1000) * 1000)
                });
            });
        } else {
            feed.item({
                title: "[RESTRICTED] 비공개 계정 또는 게시물 없음",
                description: `계정이 비공개(Private) 상태이거나 수집된 게시물이 없습니다.`,
                url: `https://instagram.com/${username}`,
                date: new Date()
            });
        }
    } else {
        feed.item({
            title: "[SYSTEM NOTICE] 인스타그램 연동 지연",
            description: "현재 일일 연동 한도가 소진되었거나 API 서버 점검 중입니다. 잠시 후 자동으로 다시 시도됩니다.",
            url: `https://instagram.com/${username}`,
            date: new Date()
        });
    }

    return new Response(feed.xml({ indent: true }), {
        status: 200,
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 's-maxage=300, stale-while-revalidate=600'
        }
    });
}
