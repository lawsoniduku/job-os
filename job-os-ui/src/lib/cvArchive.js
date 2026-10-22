const MB=1024*1024;
export const CV_LIMITS={files:50,fileBytes:5*MB,archiveBytes:25*MB,totalBytes:100*MB};
const supported=name=>/\.(pdf|docx|txt|md)$/i.test(name);
function directory(bytes) {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50&&p+22+view.getUint16(p+20,true)===bytes.length){end=p;break;}
 if(end<0)throw Error('This ZIP is incomplete or unsupported.');
 const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true);
 if(count>250||view.getUint16(end+4,true)||view.getUint16(end+6,true)||offset===0xffffffff)throw Error('Use one standard ZIP with at most 50 CVs.');
 const entries=new Map(),skipped=[];let p=offset,total=0;
 const decoder=new TextDecoder();
 for(let i=0;i<count;i++) {
  if(p+46>end||view.getUint32(p,true)!==0x02014b50)throw Error('The ZIP directory is invalid.');
  const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),size=view.getUint32(p+24,true);
  const len=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true);
  if(p+46+len+extra+comment>end)throw Error('The ZIP directory is invalid.');
  const name=decoder.decode(bytes.subarray(p+46,p+46+len));p+=46+len+extra+comment;
  if(name.includes('\0')||name.startsWith('/')||name.includes('\\')||/^[a-z]:/i.test(name)||name.split('/').includes('..'))throw Error('The ZIP contains an unsafe file path.');
  if(name.endsWith('/')||name.startsWith('__MACOSX/')||name.split('/').at(-1).startsWith('.'))continue;
  if(!supported(name)){skipped.push(name);continue;}
  if(flags&1)throw Error('Password-protected ZIP files are not supported.');
  if(![0,8].includes(method)||size===0xffffffff)throw Error('Use a standard, unencrypted ZIP.');
  if(size>CV_LIMITS.fileBytes)throw Error(`${name} exceeds the 5 MB CV limit.`);
  if(entries.has(name))throw Error('The ZIP contains duplicate file paths.');
  total+=size;entries.set(name,size);
  if(entries.size>CV_LIMITS.files||total>CV_LIMITS.totalBytes)throw Error('Split this archive into batches of up to 50 CVs and 100 MB uncompressed.');
 }
 if(!entries.size)throw Error('No supported CVs found in this ZIP. Use PDF, DOCX or TXT.');
 return {entries,skipped};
}
export async function unpackCvZip(file) {
 const {Unzip,UnzipInflate}=await import('fflate');
 if(file.size>CV_LIMITS.archiveBytes)throw Error('ZIP files must be 25 MB or smaller.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const {entries,skipped}=directory(bytes),files=[],streams=[];let total=0,failure;
 const unzip=new Unzip(stream=>{
  streams.push(stream);
  if(!entries.has(stream.name))return;
  const expected=entries.get(stream.name),chunks=[];let size=0;
  stream.ondata=(err,chunk,final)=>{
   if(failure)return;
   if(err){failure=Error(`Could not unpack ${stream.name}.`);return;}
   size+=chunk.length;total+=chunk.length;
   if(size>CV_LIMITS.fileBytes||size>expected||total>CV_LIMITS.totalBytes){failure=Error('The ZIP exceeds its declared size or the CV size limit.');stream.terminate();return;}
   chunks.push(chunk);
   if(final){if(size!==expected){failure=Error(`The ZIP contains an incomplete file: ${stream.name}.`);return;}files.push(new File(chunks,stream.name.split('/').at(-1)));}
  };
  stream.start();
 });
 unzip.register(UnzipInflate);
 try {
  // Bound each inflate input chunk; don't allocate an entire decompressed archive.
  for(let p=0;p<bytes.length;p+=4096){unzip.push(bytes.subarray(p,p+4096),p+4096>=bytes.length);if(failure)throw failure;if(p%131072===0)await new Promise(r=>setTimeout(r,0));}
  if(failure)throw failure;
  if(files.length!==entries.size)throw Error('Some CVs could not be unpacked. Try creating a new ZIP.');
  return {files,skipped};
 }finally{streams.forEach(s=>s.terminate());}
}
export async function collectCvFiles(input) {
 const files=[],skipped=[];
 for(const file of input) {
  if(/\.zip$/i.test(file.name)){const archive=await unpackCvZip(file);files.push(...archive.files);skipped.push(...archive.skipped);}
  else if(supported(file.name))files.push(file);else skipped.push(file.name);
  if(files.length>CV_LIMITS.files)throw Error('Upload up to 50 CVs at a time.');
 }
 if(files.reduce((sum,f)=>sum+f.size,0)>CV_LIMITS.totalBytes)throw Error('Keep each batch under 100 MB.');
 if(files.some(f=>f.size>CV_LIMITS.fileBytes))throw Error('Each CV must be 5 MB or smaller.');
 if(!files.length)throw Error('Choose a ZIP, PDF, DOCX or TXT file.');
 return {files,skipped};
}
