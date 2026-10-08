// Password-change AC1–AC3: real reset handler/model and mail construction, with database/SMTP boundaries controlled.
const {test,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');
process.env.GMAIL_USER='sender@gmail.com';process.env.GMAIL_APP_PASSWORD='abcdefghijklmnop';process.env.PUBLIC_APP_URL='https://events.example.test';
const {pool}=require('../../backend/src/config/db');
const {resetPassword}=require('../../backend/src/controllers/externalAuthController');
const email=require('../../backend/src/services/emailService');
const nodemailer=require('../../backend/node_modules/nodemailer');
afterEach(()=>mock.restoreAll());
/** Calls the real wrapped handler and awaits its response/error rather than the wrapper's non-returned promise. */
function reset(internal){return new Promise((resolve,reject)=>{
  const res={code:200,status(code){this.code=code;return this;},json(body){resolve({status:this.code,body});}};
  resetPassword({path:internal?'/internal/reset-password':'/reset-password',body:{token:'a'.repeat(64),password:'new-password123',email:'attacker@example.test'}},res,reject);
});}
for(const internal of [false,true]) {
  for(const scenario of ['success','delivery failure','invalid token']) {
    // AC1/AC2: literal recorded recipient and ordering protect both audiences from misdirected or premature mail.
    test(`Password-change AC1 AC2 - ${internal?'staff':'external'} ${scenario}`,async()=>{
      const operations=[];
      mock.method(pool,'query',async sql=>{
        assert.match(sql,/RETURNING id, email/);assert.match(sql,/password_reset_hash = NULL/);assert.match(sql,/password_reset_expires_at > now/);
        operations.push('persist');return {rows:scenario==='invalid token'?[]:[{id:12,email:'recorded@example.test'}]};
      });
      const send=mock.method(email,'sendPasswordChanged',async address=>{
        operations.push('notify');assert.equal(address,'recorded@example.test');
        if(scenario==='delivery failure') throw new Error('Sensitive SMTP diagnostic');
      });
      const log=mock.method(console,'error',()=>{});
      const result=await reset(internal);
      assert.equal(result.status,scenario==='invalid token'?400:200);
      assert.deepEqual(operations,scenario==='invalid token'?['persist']:['persist','notify']);
      assert.equal(send.mock.callCount(),scenario==='invalid token'?0:1);
      if(scenario==='delivery failure') {
        assert.equal(result.body.message,'Password updated. Please sign in again.');
        assert.deepEqual(log.mock.calls[0].arguments,['Password-change notification failed; check email configuration.','MAIL_ERROR']);
      }
    });
  }
}
for(const failure of [false,true]) {
  // AC3: real service builds a non-sensitive notification and always closes SMTP, even on transport rejection.
  test(`Password-change AC3 - SMTP notification contains no reset secret and closes on failure=${failure}`,async()=>{
    let message,closed=false;
    mock.method(nodemailer,'createTransport',()=>({sendMail:async value=>{message=value;if(failure)throw Object.assign(new Error('offline'),{code:'ECONNECTION'});},close:()=>{closed=true;}}));
    if(failure)await assert.rejects(email.sendPasswordChanged('recorded@example.test'),/offline/);
    else await email.sendPasswordChanged('recorded@example.test');
    assert.equal(message.to,'recorded@example.test');assert.equal(message.subject,'Your ConnectSphere password has changed');
    assert.match(message.text,/password was changed successfully/);assert.match(message.text,/contact your ConnectSphere administrator or support/);
    assert.equal(message.text.includes('new-password123'),false);assert.equal(message.text.includes('#token='),false);assert.equal(closed,true);
  });
}
// AC2: classified delivery errors log only the safe code, while password-change success remains final.
test('Password-change AC2 - classified SMTP failure retains successful reset',async()=>{
  mock.method(pool,'query',async()=>({rows:[{id:12,email:'recorded@example.test'}]}));
  mock.method(email,'sendPasswordChanged',async()=>{throw Object.assign(new Error('Private transport text'),{code:'ECONNECTION'});});
  const log=mock.method(console,'error',()=>{});
  assert.equal((await reset(true)).status,200);assert.equal(log.mock.calls[0].arguments[1],'ECONNECTION');
});

const {forgotPassword}=require('../../backend/src/controllers/externalAuthController');
/** Exercises the real recovery request handler with audience selected by its registered route. */
function requestLink(internal,emailAddress){return new Promise((resolve,reject)=>{
  const res={code:200,status(code){this.code=code;return this;},json(body){resolve({status:this.code,body});}};
  forgotPassword({path:internal?'/internal/forgot-password':'/forgot-password',body:{email:emailAddress}},res,reject);
});}
for(const internal of [false,true]) {
  // Email validation AC1: syntactically valid addresses still require an eligible database account before token creation.
  test(`Email validation AC1 - ${internal?'staff':'external'} unknown email performs lookup without storing or mailing a token`,async()=>{
    mock.method(email,'emailConfig',()=>({}));mock.method(email,'resetUrl',()=> 'https://events.example.test/reset');
    const query=mock.method(pool,'query',async(sql,values)=>{
      assert.match(sql,/SELECT/);assert.match(sql,/WHERE email = \$1/);assert.deepEqual(values,['missing@example.test']);return {rows:[]};
    });
    const send=mock.method(email,'sendPasswordReset',async()=>assert.fail('Unknown email cannot receive a link'));
    const result=await requestLink(internal,' MISSING@example.test ');
    assert.equal(result.status,404);assert.equal(result.body.message,'Account not found. Try again.');assert.equal(query.mock.callCount(),1);assert.equal(send.mock.callCount(),0);
  });
  // Email validation AC1: invalid syntax is rejected before configuration, identity lookup or token generation.
  test(`Email validation AC1 - ${internal?'staff':'external'} malformed email cannot reach persistence`,async()=>{
    const query=mock.method(pool,'query',async()=>assert.fail('Invalid email must not query database'));
    const send=mock.method(email,'sendPasswordReset',async()=>assert.fail('Invalid email must not receive a link'));
    const result=await requestLink(internal,'not-an-email');
    assert.equal(result.status,400);assert.equal(result.body.message,'Enter a valid email address.');
    assert.equal(query.mock.callCount(),0);assert.equal(send.mock.callCount(),0);
  });
}

// Password-change AC2: a database failure must never produce a misleading success notification.
test('Password-change AC2 - failed password persistence sends no notification',async()=>{
  mock.method(pool,'query',async()=>{throw new Error('database offline');});
  const send=mock.method(email,'sendPasswordChanged',async()=>assert.fail('Uncommitted change cannot be announced'));
  await assert.rejects(reset(true),/database offline/);assert.equal(send.mock.callCount(),0);
});
