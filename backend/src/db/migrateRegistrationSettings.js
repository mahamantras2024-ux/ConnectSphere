require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const {pool}=require('../config/db');
/** Applies registration controls and deadline checks atomically without replaying historical seeds. */
async function migrate(){
  const client=await pool.connect();
  try{await client.query(fs.readFileSync(path.join(__dirname,'migrations/021-registration-settings.sql'),'utf8'));}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
if(require.main===module)migrate().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports={migrate};
