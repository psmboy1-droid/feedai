import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const temp=mkdtempSync(join(tmpdir(),'feedman-social-'));
try{
 const code=ts.transpileModule(readFileSync(new URL('../lib/social-parser.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const file=join(temp,'parser.mjs');writeFileSync(file,code);
 const {socialAccount,parseX,parseInstagram,socialMediaUrl,xmlEscape}=await import(pathToFileURL(file));
 assert.equal(socialAccount('https://twitter.com/Test_User?utm_source=a').url,'https://x.com/test_user');
 assert.equal(socialAccount('https://www.instagram.com/A.B/').url,'https://www.instagram.com/a.b/');
 assert.equal(socialAccount('https://example.com/rss'),null);
 for(const url of ['https://x.com/test/status/1','https://instagram.com/p/abc','http://x.com/test','https://x.com:444/test','https://user:pass@x.com/test','https://x.com/home'])assert.throws(()=>socialAccount(url));
 for(const url of ['https://127.0.0.1/file','http://pbs.twimg.com/a','https://video.twimg.com.evil.test/a','https://video.twimg.com:444/a'])assert.throws(()=>socialMediaUrl(url));
 assert.equal(socialMediaUrl('https://scontent-a.cdninstagram.com/a.jpg').protocol,'https:');
 const fixture='tweet_results:$R[1]={rest_id:"123",result:$R[2]={rest_id:"123",core:$R[3]={user_results:$R[4]={result:$R[5]={core:$R[6]={screen_name:"test"}}}},details:$R[7]={created_at_ms:1792003557000,full_text:"Text \\"quoted\\"\\nsecond line"},media_entities2:$R[8]=[$R[9]={type:"photo",media_url_https:"https://pbs.twimg.com/media/a.jpg"},$R[10]={type:"video",allow_download_status:$R[11]={allow_download:!1},video_info:$R[12]={variants:$R[13]=[$R[14]={content_type:"video/mp4",bitrate:100,url:"https://video.twimg.com/a.mp4"},$R[15]={content_type:"video/mp4",bitrate:200,url:"https://video.twimg.com/b.mp4"}]}}]}}';
 const posts=parseX(fixture,'test');assert.equal(posts.length,1);assert.equal(posts[0].body,'Text "quoted"\nsecond line');assert.equal(posts[0].media.length,2);assert.equal(posts[0].media[1].url,'https://video.twimg.com/b.mp4');assert.equal(posts[0].media[1].status,'restricted');assert.equal(parseX(fixture,'other').length,0);
 globalThis.socialExploit=false;assert.equal(parseX('tweet_results:$R[1]={result:(globalThis.socialExploit=true)}','test').length,0);assert.equal(globalThis.socialExploit,false);
 const ig={shortcode:'abc_1',id:'9',taken_at_timestamp:1792003557,edge_media_to_caption:{edges:[{node:{text:'caption'}}]},edge_sidecar_to_children:{edges:[{node:{is_video:false,display_url:'https://scontent-a.cdninstagram.com/a.jpg'}},{node:{is_video:true,video_url:'https://scontent-a.cdninstagram.com/a.mp4'}}]}};
 const parsed=parseInstagram('<script type="application/json">'+JSON.stringify({data:ig})+'</script>');assert.equal(parsed.length,1);assert.deepEqual(parsed[0].media.map(m=>m.kind),['image','video']);assert.equal(parsed[0].body,'caption');
 assert.equal(parseInstagram('<html>Login required</html>').length,0);assert.equal(xmlEscape('<script>&"\''),'&lt;script&gt;&amp;&quot;&apos;');
 console.log('SNS parser: 27 assertions passed (URLs, SSRF host allowlist, account ownership, media order, download restriction, literal script rejection, Instagram data, XML escaping).');
}finally{rmSync(temp,{recursive:true,force:true})}
