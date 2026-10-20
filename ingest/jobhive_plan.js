// One bounded recurring inventory; adding a platform must be explicit and tested.
import {appendFileSync} from 'node:fs';
const original=['icims','phenom','recruitee','ycombinator','bamboohr'];
const added=['jazzhr','rippling','personio','pinpoint','gem','recruiterbox','eightfold',
  'greenhouse','lever','ashby','workable','smartrecruiters','teamtailor','breezy'];
const maintained=new Set([...original,...added]);
const input=(process.env.JOBHIVE_SOURCES || '').trim();
const sources=!input || input==='all' ? [...maintained] : [...new Set(input.split(',').map(s=>s.trim()))];
if(sources.some(source=>!maintained.has(source))) {
  console.error('sources must be all, blank, or comma-separated maintained ATS names.');
  process.exit(1);
}
const matrix={include:sources.map(ats=>({ats,
  prefer_confirmed:!original.includes(ats),
  max_new_rows:original.includes(ats)?500:50,
  max_new_bytes:original.includes(ats)?10*1024*1024:1024*1024,
}))};
const json=JSON.stringify(matrix);
if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`matrix=${json}\n`);
console.log(json);
