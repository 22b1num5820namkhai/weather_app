const {test}=require('node:test');
const assert=require('node:assert/strict');
const session=require('express-session');
const {createApp}=require('../server');
const {googleUser}=require('../google-auth');
const {OAuth2Client}=require('google-auth-library');
function database() {
 const users=[],identities=new Map(); let next=1;
 const state={users,identities,rollbacks:0,releases:0,failInsert:false,race:false};
 async function query(sql,args) {
  if(sql.includes('JOIN users'))return [[...identities].filter(([sub])=>sub===args[0]).map(([,id])=>users.find(u=>u.id===id))];
  if(sql.startsWith('SELECT'))return [users.filter(u=>sql.includes('WHERE id')?u.id===args[0]:u.email===args[0])];
  if(sql.startsWith('INSERT INTO users')){const id=next++;users.push({id,first_name:args[0],last_name:args[1],email:args[2],password_hash:args[3]});return [{insertId:id}];}
  if(sql.startsWith('INSERT INTO google_identities')){if(state.failInsert)throw new Error('private DB failure');identities.set(args[0],args[1]);return [{}];}
  throw new Error('Unexpected query');
 }
 state.query=query;
 state.getConnection=async()=>{
  let snapshot,links;
  return {async beginTransaction(){snapshot=users.slice();links=new Map(identities)},query:async(sql,args)=>{
    if(state.race && sql.startsWith('INSERT INTO users')){state.race=false;throw Object.assign(new Error('race'),{code:'ER_DUP_ENTRY'})}return query(sql,args)
   },async commit(){},async rollback(){state.rollbacks++;users.splice(0,users.length,...snapshot);identities.clear();for(const [k,v]of links)identities.set(k,v)},release(){state.releases++}};
 };
 return state;
}
test('Google routes: verified identity, conflicts, session rotation, expiry, logout, failures',async()=>{
 const db=database(),store=new session.MemoryStore(); let payload, reject=false,expectedNonce;
 const verifier={async verifyIdToken({audience}){assert.equal(audience,'test-client');if(reject)throw new Error('invalid signature');return {getPayload:()=>payload}}};
 const server=createApp(db,{secret:'test-only-secret-at-least-32-characters',store,googleClientId:'test-client',googleVerifier:verifier}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;let cookie='',csrf='',page='';
 const remember=r=>{if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r};
 const init=async()=>{const r=remember(await fetch(base+'/api/csrf',{headers:{Cookie:cookie}}));csrf=(await r.json()).csrfToken;expectedNonce=csrf;};
 const claims=()=>({sub:'google-sub-1',email:'google@example.com',email_verified:true,given_name:'Test',family_name:'Google',iss:'https://accounts.google.com',aud:'test-client',exp:Math.floor(Date.now()/1000)+3600,nonce:expectedNonce});
 const post=async(path,body,token=csrf)=>remember(await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':token,'X-Page-Token':page},body:JSON.stringify(body)}));
 try{
  assert.equal((await post('/api/auth/google',{credential:'token'})).status,403);await init();payload=claims();
  assert.equal((await post('/api/auth/google',{})).status,400);assert.equal((await post('/api/auth/google',{credential:123})).status,400);
  reject=true;assert.equal((await post('/api/auth/google',{credential:'forged'})).status,401);reject=false;
  for(const invalid of [{exp:1},{aud:'wrong-client'},{iss:'evil'},{nonce:'wrong'},{email_verified:false},{sub:''}]){payload={...claims(),...invalid};assert.equal((await post('/api/auth/google',{credential:'token'})).status,401)}
  payload=claims();const anonymous=cookie;const login=await post('/api/auth/google',{credential:'token'});assert.equal(login.status,200);const result=await login.json();assert.notEqual(cookie,anonymous);assert.notEqual(result.csrfToken,csrf);csrf=result.csrfToken;page=result.pageToken;
  assert.equal(db.users.length,1);assert.equal(db.identities.size,1);assert.match(db.users[0].password_hash,/^\$2/);assert.equal(result.user.password_hash,undefined);
  const me=()=>fetch(base+'/api/me',{headers:{Cookie:cookie,'X-Page-Token':page}});assert.equal((await me()).status,200);
  // Refresh uses same per-tab token, while cookie-only requests remain rejected.
  assert.equal((await me()).status,200);assert.equal((await fetch(base+'/api/me',{headers:{Cookie:cookie}})).status,401);
  const saved=cookie;assert.equal((await post('/api/logout',{})).status,200);assert.equal((await fetch(base+'/api/me',{headers:{Cookie:saved,'X-Page-Token':page}})).status,401);
  await init();payload={...claims(),email:'changed@example.com'};const again=await post('/api/auth/google',{credential:'token'});assert.equal(again.status,200);const returning=await again.json();csrf=returning.csrfToken;page=returning.pageToken;assert.equal(db.users.length,1);
  // Mapped Google-only users cannot authenticate by password, even with a matching test hash.
  db.users[0].google_only = 1;
  db.users[0].password_hash = await require('bcrypt').hash('known-test-password', 4);
  assert.equal((await post('/api/login',{email:db.users[0].email,password:'known-test-password'})).status,401);
  // Expired sessions cannot authorize /me.
  await new Promise(resolve=>store.all((err,sessions)=>{for(const [id,value]of Object.entries(sessions)){if(value.userId){value.authExpires=1;store.set(id,value,resolve);return}}resolve()}));assert.equal((await me()).status,401);
  await init();db.users.push({id:999,email:'password@example.com'});payload={...claims(),sub:'other-sub',email:'password@example.com'};assert.equal((await post('/api/auth/google',{credential:'token'})).status,409);assert.equal(db.identities.size,1);
  db.failInsert=true;payload={...claims(),sub:'failed-sub',email:'new@example.com'};const failed=await post('/api/auth/google',{credential:'token'});assert.equal(failed.status,500);assert.ok(!(await failed.text()).includes('private'));assert.equal(db.users.length,2);assert.ok(db.rollbacks>=2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('transaction retries duplicate race and releases connections',async()=>{
 const db=database();db.race=true;const user=await googleUser(db,{sub:'race-sub',email:'race@example.com'});assert.ok(user.id);assert.equal(db.users.length,1);assert.equal(db.rollbacks,1);assert.equal(db.releases,2);
});
test('official verifier rejects malformed token without trusting decoded claims',async()=>{
 await assert.rejects(new OAuth2Client().verifyIdToken({idToken:'not-a-jwt',audience:'test-client'}));
});
test('rate limit and security headers',async()=>{
 const server=createApp(database(),{secret:'test-only-secret-at-least-32-characters',store:new session.MemoryStore(),rateLimit:2}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const r=await fetch(base);assert.match(r.headers.get('content-security-policy'),/accounts.google.com/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');for(let i=0;i<2;i++)await fetch(base+'/api/login',{method:'POST'});assert.equal((await fetch(base+'/api/login',{method:'POST'})).status,429);}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});

test('official verification: signed fixture, forged signature, expiry, issuer and audience',async()=>{
 const {generateKeyPairSync,sign}=require('node:crypto');
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const client=new OAuth2Client();
 // Only replace network key retrieval. The real Google verification code validates each JWT.
 client.getFederatedSignonCertsAsync=async()=>({certs:{fixture:publicKey.export({type:'spki',format:'pem'})}});
 const now=Math.floor(Date.now()/1000);
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const jwt=changes=>{const data=encode({alg:'RS256',kid:'fixture'})+'.'+encode({sub:'fixture-sub',iss:'https://accounts.google.com',aud:'fixture-client',iat:now,exp:now+3600,...changes});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')};
 assert.equal((await client.verifyIdToken({idToken:jwt({}),audience:'fixture-client'})).getPayload().sub,'fixture-sub');
 for(const changes of [{aud:'wrong'},{iss:'evil'},{iat:now-7200,exp:now-3600}])await assert.rejects(client.verifyIdToken({idToken:jwt(changes),audience:'fixture-client'}));
 const forged=jwt({}).split('.');forged[1]=encode({sub:'attacker',iss:'https://accounts.google.com',aud:'fixture-client',iat:now,exp:now+3600});await assert.rejects(client.verifyIdToken({idToken:forged.join('.'),audience:'fixture-client'}));
});

test('session persistence failure never reports login success',async()=>{
 const db=database(),store=new session.MemoryStore();
 const originalSet=store.set.bind(store);store.set=(id,value,callback)=>value.userId?callback(new Error('store failed')):originalSet(id,value,callback);
 const verifier={async verifyIdToken(){return {getPayload:()=>payload}}};let payload;
 const server=createApp(db,{secret:'test-only-secret-at-least-32-characters',store,googleClientId:'test',googleVerifier:verifier}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const init=await fetch(base+'/api/csrf');const csrf=(await init.json()).csrfToken;const cookie=init.headers.get('set-cookie').split(';')[0];payload={sub:'save-fail',email:'save@example.com',email_verified:true,iss:'accounts.google.com',aud:'test',exp:Math.floor(Date.now()/1000)+3600,nonce:csrf};const response=await fetch(base+'/api/auth/google',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({credential:'fixture'})});assert.equal(response.status,500);assert.equal((await response.json()).authenticated,undefined);}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
