const encoder=new TextEncoder();
export const CV_BATCH_BYTES=400*1024;
export const cvImportPayload=batch=>({candidates:batch.map(c=>({filename:c.filename,text:c.text}))});
export function cvUploadBatches(candidates) {
 const batches=[];let batch=[];
 for(const c of candidates){
  const entry={...c,filename:String(c.filename || '').slice(0,200),text:String(c.text || '').trim().slice(0,50000)};
  const next=[...batch,entry];
  if(batch.length&&(next.length>10||encoder.encode(JSON.stringify(cvImportPayload(next))).byteLength>CV_BATCH_BYTES)){batches.push(batch);batch=[];}
  if(encoder.encode(JSON.stringify(cvImportPayload([entry]))).byteLength>CV_BATCH_BYTES)throw Error('This CV text is too large to import.');
  batch.push(entry);
 }
 if(batch.length)batches.push(batch);
 return batches;
}
