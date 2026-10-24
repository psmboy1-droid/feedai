import {isRssAdmin} from '../../../lib/rss-admin';
import SocialAdmin from '../../../components/social-admin';
export const dynamic='force-dynamic';
export default async function Page(){if(!await isRssAdmin())return <p>관리자 권한이 필요합니다.</p>;return <SocialAdmin/>}
