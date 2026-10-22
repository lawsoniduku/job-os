// A small PostgREST-shaped adapter for isolated API tests. SQL and RPCs still
// execute against real in-memory Postgres; no production credentials exist.
const ident=x=>{if(!/^[a-z_][a-z0-9_]*$/i.test(x))throw Error('Invalid fixture identifier');return '"'+x+'"';};
const tables=new Set(['employer_orgs','employer_members','job_postings','posting_submissions','hiring_reviews','hiring_activity','candidate_feedback','intro_requests','profiles','saved_cvs','applications','jobs']);
const splitColumns=s=>{const out=[];let depth=0,start=0;for(let i=0;i<s.length;i++){if(s[i]==='(')depth++;if(s[i]===')')depth--;if(s[i]===','&&!depth){out.push(s.slice(start,i).trim());start=i+1;}}out.push(s.slice(start).trim());return out;};
export function hiringApiDb(db) {
 const wrap={auth:{getUser:async token=>({data:{user:['qa-token','qa-candidate'].includes(token)?{id:token==='qa-token'?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000008',email:'synthetic@example.invalid'}:null},error:null})},
  async rpc(name,args){try{const params=Object.values(args);const query=`select * from ${ident(name)}(${Object.keys(args).map((k,i)=>`${ident(k)} => $${i+1}`).join(',')})`;const result=await db.query(query,params);const scalar=['save_hiring_review','record_hiring_decision'].includes(name);return {data:scalar?result.rows[0]?.[name]:result.rows,error:null};}catch(e){return {data:null,error:{code:e.code,message:e.message}};}},
  from(table){if(!tables.has(table))throw Error('Unexpected fixture table '+table);
   let columns='*',method='get',payload,opts={},filters=[],orders=[],limit=null,single=false;
   const q={select(value='*'){columns=value;return q;},eq(k,v){filters.push([k,'=',v]);return q;},neq(k,v){filters.push([k,'<>',v]);return q;},gt(k,v){filters.push([k,'>',v]);return q;},lt(k,v){filters.push([k,'<',v]);return q;},is(k,v){filters.push([k,'is',v]);return q;},in(k,v){filters.push([k,'in',v]);return q;},order(k,o={}){orders.push(ident(k)+(o.ascending===false?' desc':' asc')+(o.nullsFirst===false?' nulls last':''));return q;},limit(n){limit=n;return q;},insert(v){method='insert';payload=v;return q;},upsert(v,o={}){method='upsert';payload=v;opts=o;return q;},update(v){method='update';payload=v;return q;},delete(){method='delete';return q;},single(){single=true;return execute();},maybeSingle(){single=true;return execute();},then(a,b){return execute().then(a,b);}};
   async function execute(){try{
    const values=[];const param=v=>{values.push(v);return '$'+values.length;};
    const where=()=>filters.length?' where '+filters.map(([k,op,v])=>op==='is'?`${ident(k)} is ${v===null?'null':v===true?'true':'false'}`:op==='in'?`${ident(k)} = any(${param(v)})`:`${ident(k)} ${op} ${param(v)}`).join(' and '):'';
    let sql;
    if(method==='get')sql=`select * from ${ident(table)}`+where()+(orders.length?' order by '+orders.join(','):'')+(limit?' limit '+Number(limit):'');
    if(method==='delete')sql=`delete from ${ident(table)}`+where()+' returning *';
    if(method==='update'){const entries=Object.entries(payload);sql=`update ${ident(table)} set `+entries.map(([k,v])=>`${ident(k)}=${param(v)}`).join(',')+where()+' returning *';}
    if(method==='insert'||method==='upsert'){const batch=Array.isArray(payload)?payload:[payload],keys=Object.keys(batch[0]);sql=`insert into ${ident(table)} (${keys.map(ident).join(',')}) values `+batch.map(row=>'('+keys.map(k=>param(row[k])).join(',')+')').join(',');if(method==='upsert')sql+=` on conflict (${opts.onConflict.split(',').map(ident).join(',')}) `+(opts.ignoreDuplicates?'do nothing':'do update set '+keys.filter(k=>k!=='id').map(k=>`${ident(k)}=excluded.${ident(k)}`).join(','));sql+=' returning *';}
    // PostgreSQL JSON serialization preserves microseconds, just like PostgREST.
    const r=await db.query('with result as ('+sql+') select to_jsonb(result) as row from result',values);
    let rows=r.rows.map(r=>r.row);
    if(columns!=='*')rows=await Promise.all(rows.map(async row=>{const out={};for(const col of splitColumns(columns)){if(col==='*'){Object.assign(out,row);continue;}const related=col.match(/^(employer_orgs|job_postings)\((.*)\)$/);if(related){const name=related[1],key=name==='employer_orgs'?'org_id':'posting_id';const rel=await db.query(`select to_jsonb(t) as row from ${ident(name)} t where id=$1`,[row[key]]);out[name]=rel.rows[0]?.row || null;}else out[col]=row[col];}return out;}));
    return {data:single?rows[0]||null:rows,error:null};
   }catch(e){return {data:null,error:{code:e.code,message:e.message}};}}
   return q;
  }};return wrap;
}
