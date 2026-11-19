const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('frontend Google callback, refresh restoration, separate forms and logout',async()=>{
 const elements=new Map(),storage=new Map(),events={};let callback,sessionActive=false;const calls=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',value:'',disabled:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn},querySelector(selector){return element(id+selector)},reset(){},focus(){}});return elements.get(id)};
 const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
 const user={first_name:'Test',last_name:'Google'};
 const browser={google:{accounts:{id:{initialize(config){callback=config.callback},renderButton(){},disableAutoSelect(){}}}},addEventListener(type,fn){events[type]=fn}};
 const context=vm.createContext({window:browser,document:{getElementById:element,querySelector:element},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},TextEncoder,FormData:class{constructor(){return [['first_name','Test'],['last_name','User'],['email','test@example.com'],['password','test-password']] }},fetch:async(url,options={})=>{
  calls.push([url,options]);
  if(url==='/api/csrf')return response(200,{csrfToken:'csrf'});
  if(url==='/api/auth/config')return response(200,{googleClientId:'public-test-client'});
  if(url==='/api/auth/google'){assert.equal(options.headers['X-CSRF-Token'],'csrf');assert.equal(options.credentials,'same-origin');assert.deepEqual(JSON.parse(options.body),{credential:'transient-google-token'});sessionActive=true;return response(200,{user,pageToken:'page',csrfToken:'csrf-new'})}
  if(url==='/api/me'){assert.equal(options.headers['X-Page-Token'],'page');return sessionActive?response(200,{user}):response(401,{})}
  if(url==='/api/logout'){sessionActive=false;return response(200,{})}
  if(url==='/api/register')return response(201,{message:'registered'});
  throw new Error('Unexpected URL');
 }});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../../frontend/register.js'),'utf8'),context);
 await new Promise(setImmediate);assert.equal(typeof callback,'function');
 element('show-register').listeners.click({preventDefault(){}});assert.equal(element('loginForm').hidden,true);assert.equal(element('registerForm').hidden,false);
 await element('registerForm').listeners.submit({preventDefault(){}});assert.equal(element('registerForm').hidden,true);assert.equal(element('loginForm').hidden,false);assert.equal(element('loginEmail').value,'test@example.com');
 await callback({credential:'transient-google-token'});assert.equal(element('.weather-app').hidden,false);assert.equal(storage.get('weather.pageToken'),'page');assert.ok(![...storage.values()].includes('transient-google-token'));
 // Model a new document after refresh with shared per-tab sessionStorage.
 vm.runInContext('pageToken = sessionStorage.getItem("weather.pageToken");',context);await events.pageshow();assert.equal(element('.weather-app').hidden,false);
 await element('logout-button').listeners.click({currentTarget:element('logout-button')});assert.equal(element('.weather-app').hidden,true);assert.equal(storage.has('weather.pageToken'),false);
});
