import {isRssAdmin} from '../../../lib/rss-admin';
import {chatGPTSignInPath} from '../../chatgpt-auth';
import DopamineAdmin from '../../../components/dopamine-admin';
export const dynamic='force-dynamic';
export default async function Page(){if(!await isRssAdmin())return <div className="admin-page"><h1>유튜브 피드 관리</h1><p>관리자 계정으로 로그인해 주세요.</p><a href={chatGPTSignInPath('/admin/dopamine')} target="_top">관리자 로그인</a></div>;return <DopamineAdmin/>}
