import {isRssAdmin} from '../../../lib/rss-admin';
import {getChatGPTUser,chatGPTSignInPath} from '../../chatgpt-auth';
import AiSettings from '../../../components/ai-settings';
export const dynamic='force-dynamic';
export default async function Page(){const user=await getChatGPTUser();if(!await isRssAdmin())return <div className="admin-page"><a href="/">← 피드로 돌아가기</a><h1>AI API 설정</h1><p>{user?'관리자만 접근할 수 있습니다.':'관리자 계정으로 로그인해 주세요.'}</p>{!user&&<a className="account-link" href={chatGPTSignInPath('/admin/ai')} target="_top">관리자 로그인</a>}</div>;return <AiSettings/>}
