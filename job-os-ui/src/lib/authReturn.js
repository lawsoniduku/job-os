// Only the product's known internal surfaces may be restored after OAuth.
// This stores a path and timestamp, never tokens, credentials or arbitrary URLs.
const KEY='jobcopilot.auth-return.v1';
const MAX_AGE_MS=15*60*1000;
export function authReturnStorage(browser){try{return browser.localStorage;}catch{return null;}}
export function allowedAuthPath(path) {
 if(path==='/employer'||path==='/employer/')return '/employer';
 return /^\/apply\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(path)?path:null;
}
export function rememberAuthReturn(storage,path,now=Date.now()) {
 try{const safe=allowedAuthPath(path);if(safe)storage.setItem(KEY,JSON.stringify({path:safe,at:now}));else storage.removeItem(KEY);}catch{/* Privacy mode can disable storage; authentication still works. */}
}
export function clearAuthReturn(storage){try{storage.removeItem(KEY);}catch{/* Storage unavailable. */}}
export function consumeAuthReturn(storage,{pathname,search='',hash=''},now=Date.now()) {
 // The existing root callback remains on Supabase's allowed Site URL. Move
 // its fragment only within this origin, before the lazy client processes it.
 if(pathname!=='/'||!(/(?:^#|&)(access_token|error)=/.test(hash)||new URLSearchParams(search).get('code')))return null;
 try {
  const record=JSON.parse(storage.getItem(KEY)||'null');clearAuthReturn(storage);
  if(!record||!Number.isFinite(record.at)||record.at>now||now-record.at>MAX_AGE_MS)return null;
  return allowedAuthPath(record.path);
 }catch{return null;}
}
