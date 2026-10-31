require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const {pool}=require('../config/db');
/** Applies the additive session-isolation trigger on one connection without replaying seeds or earlier migrations. */
async function migrate(){
  const client=await pool.connect();
  try{await client.query(fs.readFileSync(path.join(__dirname,'migrations/020-session-venue-requests.sql'),'utf8'));}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
if(require.main===module)migrate().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports={migrate};
