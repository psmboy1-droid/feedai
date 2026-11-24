import CommunityList from '../../../components/community-list';

export const metadata = {
    title: '자유 게시판 | FeedAI 커뮤니티',
    description: '피드AI 회원들의 자유로운 소통 공간',
};

export default function CommunityFreePage() {
    return <CommunityList board="free" />;
}
