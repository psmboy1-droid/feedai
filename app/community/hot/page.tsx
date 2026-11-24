import CommunityList from '../../../components/community-list';

export const metadata = {
    title: 'HOT 게시판 | FeedAI 커뮤니티',
    description: '피드AI 회원들의 실시간 인기글 20선',
};

export default function CommunityHotPage() {
    return <CommunityList board="hot" />;
}
