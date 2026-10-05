// File: Verifies server startup waits for database initialization and uses the configured/default port.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// Test case: Captures startup calls and checks initialization finishes before listening on configured/default ports.
test('API startup waits for initialization before listening on a configured or default port',async()=>{
 const filename=path.join(__dirname,'../../backend/src/index.js');
 for(const port of [undefined,'4321']) {
  const seen=[];let initialize;
  const application={use(){},get(){},listen(value,callback){seen.push(value);callback();}};
  const express=()=>application;express.json=()=>()=>{};express.urlencoded=()=>()=>{};
  const entry={exports:{}};
  // Supplies startup dependencies without opening real database connections or ports.
  function requireFixture(name){
   if(name==='dotenv')return {config(){}};
   if(name==='express')return express;
   if(name==='cors'||name==='morgan')return ()=>()=>{};
   if(name==='./config/db')return {connectDB:()=>new Promise(resolve=>{initialize=resolve;})};
   if(name==='./middleware/errorHandler')return {errorHandler(){}};
   if(name.startsWith('./routes/'))return {};
   throw new Error(`Unexpected startup dependency: ${name}`);
  }
  requireFixture.main=entry;
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:requireFixture,module:entry,process:{env:{PORT:port,CORS_ORIGIN:port?'http://localhost:5173':undefined}},console:{log(){}}},{filename});
  assert.deepEqual(seen,[]);initialize();await Promise.resolve();assert.deepEqual(seen,[port||4000]);assert.equal(entry.exports,application);
 }
});
