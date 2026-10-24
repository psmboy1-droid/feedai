import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {socialPostForUser} from '../../../../lib/social-service';
export async function GET(req:Request){
 const user=await getChatGPTUser();if(!user)return new Response('로그인이 필요합니다.',{status:401});
 try{
  const p=new URL(req.url).searchParams;if(!/^\d+$/.test(p.get('index')||''))throw Error('index');
  const row=await socialPostForUser(p.get('url')||'',user.userId),media=JSON.parse(row.media)[Number(p.get('index'))];
  if(!media?.key||!env.BUCKET)return new Response('파일을 수집하지 못했습니다.',{status:404});
  const range=req.headers.get('range');if(range&&!/^bytes=\d+-\d*$/.test(range))return new Response(null,{status:416});
  const object=await env.BUCKET.get(media.key,{range:req.headers});if(!object)return new Response(null,{status:404});
  const headers=new Headers({'Content-Type':media.mime,'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'});
  const r=object.range;
  if(r&&'offset'in r&&'length'in r&&typeof r.offset==='number'&&typeof r.length==='number'){
   headers.set('Content-Range',`bytes ${r.offset}-${r.offset+r.length-1}/${object.size}`);headers.set('Content-Length',String(r.length));
  }else headers.set('Content-Length',String(object.size));
  return new Response(object.body,{status:headers.has('Content-Range')?206:200,headers});
 }catch{return new Response('접근할 수 없습니다.',{status:403})}
}
