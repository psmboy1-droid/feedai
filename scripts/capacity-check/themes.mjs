import assert from 'node:assert/strict';
import {cleanBrief} from '../../lib/today-brief.ts';
const snapshot={articles:[{id:'n1'}]};
const theme={title:'주제',importance:80,rationale:'근거',impact:'영향',direction:'혼재',horizon:'단기',markets:['미국'],stocks:[],articleIds:['n1']};
const brief=n=>({headline:'요약',overview:[],marketMood:'혼재',themes:Array.from({length:n},(_,i)=>({...theme,title:'주제 '+i})),watchpoints:[],excludedReason:''});
for(const n of [0,5,15,25])assert.equal(cleanBrief(JSON.stringify(brief(n)),snapshot).themes.length,n);
assert.throws(()=>cleanBrief(JSON.stringify(brief(26)),snapshot));
const invalid=brief(2);invalid.themes[0].importance=69;invalid.themes[1].articleIds=['unknown'];assert.equal(cleanBrief(JSON.stringify(invalid),snapshot).themes.length,0);
console.log('Theme limits 15/25, shortage and evidence filtering passed');
