import {z} from 'zod';
const webUrl=z.string().trim().url().refine(value=>{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password},'HTTP 또는 HTTPS 주소를 입력해 주세요.');
export const seoSchema=z.object({
 title:z.string().trim().min(1).max(100),
 description:z.string().trim().min(1).max(500),
 keywords:z.string().trim().max(1000),
 siteUrl:webUrl.refine(value=>{const u=new URL(value);return u.pathname==='/'&&!u.search&&!u.hash},'사이트의 기본 주소만 입력해 주세요.').transform(value=>new URL(value).origin),
 imageUrl:z.union([z.literal(''),webUrl]),
 imageAlt:z.string().trim().max(200),
 indexable:z.boolean(),
});
export type SeoSettings=z.infer<typeof seoSchema>;
export const defaultSeo:SeoSettings={title:'피드AI | 나만의 RSS 피드',description:'관심 있는 소식만, 한곳에서. 원하는 RSS 소스를 선택하고 다국어 피드와 AI 시장 분석을 확인하세요.',keywords:'RSS, 피드AI, 피드, 뉴스 수집, AI 시장 분석',siteUrl:'https://hanstaget.com',imageUrl:'',imageAlt:'피드AI',indexable:true};
export const privateRobots={index:false,follow:false};
export function seoMetadata(s:SeoSettings){return {metadataBase:new URL(s.siteUrl),title:s.title,description:s.description,keywords:s.keywords.split(',').map(k=>k.trim()).filter(Boolean),alternates:{canonical:s.siteUrl+'/'},robots:{index:s.indexable,follow:s.indexable},openGraph:{type:'website' as const,locale:'ko_KR',siteName:'피드AI',title:s.title,description:s.description,url:s.siteUrl+'/',images:s.imageUrl?[{url:s.imageUrl,alt:s.imageAlt}]:[]},twitter:{card:s.imageUrl?'summary_large_image' as const:'summary' as const,title:s.title,description:s.description,images:s.imageUrl?[s.imageUrl]:[]}}}
export function robotsText(s:SeoSettings){return `User-agent: *\nAllow: /\nDisallow: /my-feed\nDisallow: /today\nDisallow: /news\nDisallow: /admin\nDisallow: /api\nDisallow: /login\nDisallow: /signout-with-chatgpt\n`+(s.indexable?`\nSitemap: ${s.siteUrl}/sitemap.xml\n`:'')}
export function sitemapText(s:SeoSettings){const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+(s.indexable?'<url><loc>'+escape(s.siteUrl+'/')+'</loc></url>':'')+'</urlset>'}
