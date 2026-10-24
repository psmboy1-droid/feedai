import {isRssAdmin} from '../../../lib/rss-admin';
import {getChatGPTUser,chatGPTSignInPath} from '../../chatgpt-auth';
import MemberAdmin from '../../../components/member-admin';
export const dynamic='force-dynamic';
export default async function Page(){const user=await getChatGPTUser();if(!await isRssAdmin())return <div className="admin-page"><a href="/">← 피드로 돌아가기</a><h1>회원 관리</h1><p>관리자만 접근할 수 있습니다.</p>{!user&&<a href={chatGPTSignInPath('/admin/members')} target="_top">관리자 로그인</a>}</div>;return <MemberAdmin/>}
