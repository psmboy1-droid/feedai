// A bounded HTML tree lets us remove entire widgets and respect closing tags.
type Node={tag:string;attrs:string;start:number;openEnd:number;end:number;closeStart:number;children:Node[]};
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function tree(html:string){
 const root:Node={tag:'root',attrs:'',start:0,openEnd:0,end:html.length,closeStart:html.length,children:[]};const stack=[root];let count=0;
 for(const m of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)){
  if(!m[1])continue;if(++count>40000)break;const tag=m[1].toLowerCase(),start=m.index!,end=start+m[0].length;
  if(m[0].startsWith('</')){let i=stack.length-1;while(i>0&&stack[i].tag!==tag)i--;if(i){while(stack.length>i){const n=stack.pop()!;n.closeStart=start;n.end=end}}continue}
  if(['p','li'].includes(tag)&&stack[stack.length-1].tag===tag){const n=stack.pop()!;n.closeStart=start;n.end=start}
  const n:Node={tag,attrs:m[0],start,openEnd:end,end:html.length,closeStart:html.length,children:[]};stack[stack.length-1].children.push(n);if(voidTags.has(tag)||m[0].endsWith('/>')){n.end=end;n.closeStart=end}else stack.push(n);
 }
 return root;
}
function attr(s:string,key:string){return s.match(new RegExp('\\b'+key+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'))?.slice(1).find(v=>v!==undefined)||''}
function unwanted(n:Node){
 if(['script','style','nav','aside','footer','header','form','noscript','iframe','svg','button'].includes(n.tag))return true;
 const labels=attr(n.attrs,'class')+' '+attr(n.attrs,'id')+' '+attr(n.attrs,'role');
 return /(?:\s)hidden(?:\s|=|\/?>)/i.test(n.attrs)||attr(n.attrs,'aria-hidden')==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr(n.attrs,'style'))||/(?:^|[\s_-])(?:ad|ads|advertisement|advertising|advert|related|recommended|recommendation|recommendations|recirculation|sidebar|share|sharing|social|newsletter|subscribe|subscription|comments|comment|author-bio|cookie|breadcrumb|breadcrumbs|navigation|menu)(?:$|[\s_-])/i.test(labels);
}
function render(html:string,n:Node):string{
 if(unwanted(n))return '';let out=n.tag==='root'?'':html.slice(n.start,n.openEnd),cursor=n.openEnd;
 for(const child of n.children){out+=html.slice(cursor,child.start)+render(html,child);cursor=child.end}
 out+=html.slice(cursor,n.closeStart);if(n.tag!=='root')out+=html.slice(n.closeStart,n.end);return out;
}
export function cleanArticleHtml(html:string){return render(html,tree(html.replace(/<!--[\s\S]*?-->|<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'')))}
export function selectArticleRegion(html:string){
 const nodes:Node[]=[];function walk(n:Node){for(const c of n.children){nodes.push(c);walk(c)}}walk(tree(html));
 const marked=nodes.filter(n=>/article[-_]?(?:body|content|text)|entry-content|story-body|caas-body/i.test(attr(n.attrs,'class')+' '+attr(n.attrs,'id'))||attr(n.attrs,'itemprop').split(/\s+/).includes('articleBody'));
 const candidates=marked.length?marked:nodes.filter(n=>n.tag==='article');
 const mains=nodes.filter(n=>n.tag==='main');
 const pool=candidates.length?candidates:mains;
 function score(n:Node){const region=html.slice(n.openEnd,n.closeStart);const text=region.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();return text.length}
 const best=pool.sort((a,b)=>score(b)-score(a))[0];return best?html.slice(best.openEnd,best.closeStart):'';
}
