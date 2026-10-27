const {test}=require('node:test');
const assert=require('node:assert/strict');
const origin='https://map.badass.lighting';
function request(path,fields={},headers={}) {return new Request(origin+path,{method:'POST',headers:{Origin:origin,...headers},body:new URLSearchParams(fields)});}
function database(){const writes=[];return {writes,prepare(sql){return {bind(...args){return {sql,args,async run(){writes.push({sql,args});},async first(){return null;}};}};},async batch(items){writes.push(...items);}};}
test('verification fails closed and creates anonymous session only for matching hostname/action',async()=>{
 const {onRequestPost}=await import('../functions/auth/start.js');
 const old=global.fetch; const DB=database(); const env={DB,TURNSTILE_SECRET:'test'};
 try {
  let calls=0;global.fetch=async()=>{calls++;return Response.json({success:true,hostname:'map.badass.lighting',action:'object_tree'});};
  let r=await onRequestPost({request:request('/auth/start'),env});assert.equal(r.status,303);assert.equal(calls,0);assert.equal(DB.writes.length,0);
  r=await onRequestPost({request:request('/auth/start',{'cf-turnstile-response':'valid'},{Origin:'https://evil.example'}),env});assert.equal(r.status,403);assert.equal(calls,0);
  for (const result of [{success:false},{success:true,hostname:'other.example',action:'object_tree'},{success:true,hostname:'map.badass.lighting',action:'newsletter'}]) {
   global.fetch=async()=>Response.json(result);r=await onRequestPost({request:request('/auth/start',{'cf-turnstile-response':'bad'}),env});assert.match(r.headers.get('Location'),/error=/);assert.equal(DB.writes.length,0);
  }
  global.fetch=async()=>Response.json({success:true,hostname:'map.badass.lighting',action:'object_tree'});
  r=await onRequestPost({request:request('/auth/start',{'cf-turnstile-response':'good'}),env});assert.equal(r.headers.get('Location'),origin+'/');
  assert.match(r.headers.get('Set-Cookie'),/verified=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  assert.equal(DB.writes.length,2);assert.doesNotMatch(DB.writes[1].sql,/email|users/);
  const token=r.headers.get('Set-Cookie').match(/verified=([^;]+)/)[1];assert.notEqual(DB.writes[1].args[0],token);
 } finally {global.fetch=old;}
});
test('newsletter requires consent and separate verification, never grants access',async()=>{
 const {onRequestPost}=await import('../functions/auth/newsletter.js');const old=global.fetch;const DB=database();const env={DB};
 try {
  global.fetch=async()=>Response.json({success:true,hostname:'map.badass.lighting',action:'newsletter'});
  for(const fields of [{email:'a@example.com'},{email:'bad',consent:'1'},{email:'a@example.com',consent:'1'}]) {
   const r=await onRequestPost({request:request('/auth/newsletter',fields),env});assert.match(r.headers.get('Location'),/error=/);assert.equal(DB.writes.length,0);
  }
  const r=await onRequestPost({request:request('/auth/newsletter',{email:'A@example.com',consent:'1','cf-turnstile-response':'valid'}),env});assert.match(r.headers.get('Location'),/subscribed=1/);assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(DB.writes[0].args[0],'a@example.com');
 } finally {global.fetch=old;}
});
test('middleware protects tree data, accepts valid anonymous session, rejects expired session',async()=>{
 const {onRequest}=await import('../functions/_middleware.js');
 for(const valid of [false,true]) {
  const DB={prepare(sql){assert.match(sql,/expires > \?/);return {bind(hash,now){assert.equal(hash.length,64);assert.ok(now>0);return {async first(){return valid ? {expires:now+10}:null;}};}};}};
  const response=await onRequest({request:new Request(origin+'/tree.json',{headers:{Cookie:'verified='+'a'.repeat(64)}}),env:{DB},data:{},next:async()=>new Response('tree')});
  assert.equal(response.status,valid?200:401);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 }
});
test('login escapes errors, has no Google login and keeps newsletter consent unchecked',async()=>{
 const {onRequestGet}=await import('../functions/login.js');
 const r=await onRequestGet({env:{TURNSTILE_SITEKEY:'key',COFFEE_URL:'https://buymeacoffee.com/example'},request:new Request(origin+'/login?error=%3Cscript%3E')});const html=await r.text();
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('data-action="object_tree"'));assert.ok(html.includes('data-action="newsletter"'));assert.ok(html.includes('Buy me a beer!'));assert.ok(!html.includes('Sign in with Google'));assert.ok(!html.includes('checked'));
});

