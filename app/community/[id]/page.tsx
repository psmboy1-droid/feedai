import CommunityDetail from '../../../components/community-detail';

export const metadata = {
    title: '게시글 | FeedAI 커뮤니티',
    description: '피드AI 커뮤니티 게시글 상세',
};

export default async function CommunityDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <CommunityDetail postId={id} />;
}
