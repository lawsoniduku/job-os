import { createHash } from 'node:crypto';
const etag = row => createHash('sha256').update(JSON.stringify(row.elig_signals ?? null)).digest('hex');
export function evidenceDb(initial, handler = async () => ({error:null})) {
  const rows=new Map(initial.map(r=>[r.id,structuredClone(r)]));
  const db={rows,beforeWrite:null,from:()=>{
    let id, payload, expected, expectedEtag, constrain=false;
    const q={
      eq:(key,value)=>{if(key==='id')id=value;if(key==='elig_signals_etag')expectedEtag=value;return q;},
      is:(_key,value)=>{expected=value;constrain=true;return q;},
      filter:(_key,_op,value)=>{expected=JSON.parse(value);constrain=true;return q;},
      update:value=>{payload=value;return q;},
      select:()=>payload ? q : q,
      maybeSingle:async()=>{const row=rows.get(id);return {data:row?{...structuredClone(row),elig_signals_etag:etag(row)}:null,error:null};},
      then:async (resolve,reject)=>{
        try {
        if(db.beforeWrite)await db.beforeWrite(id,payload);
        const row=rows.get(id);
        if(!row || (expectedEtag && etag(row)!==expectedEtag) || (constrain&&JSON.stringify(row.elig_signals??null)!==JSON.stringify(expected)))return resolve({data:[],error:null});
        const result=await handler(id,payload);
        if(result?.error)return resolve(result);
        rows.set(id,{...row,...structuredClone(payload)});
        resolve({data:[{id}],error:null});
        } catch(error) {reject(error);}
      },
    };return q;
  }};return db;
}

