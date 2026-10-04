// File: Streams committed venue changes across API instances using PostgreSQL notifications.
const { pool } = require('../config/db');
const subscribers = new Set();
let connection, connecting=false, retry;
// Shares one LISTEN connection while any catalogue is open and reconnects after interruptions.
async function listen() {
 if(connection || connecting || !subscribers.size) return;
 connecting=true;
 try {
  const client=await pool.connect();
  if(!subscribers.size) {client.release(); return;}
  connection=client;
  client.on('notification', notification => { // Invalidates catalogues without publishing venue or booking details.
   if(notification.channel==='venue_catalogue_changed') for(const response of subscribers) response.write('data: changed\n\n');
  });
  client.once('error', () => { // Releases a failed listener and schedules a bounded reconnect.
   if(connection===client) connection=undefined; client.release(true);
   retry=setTimeout(listen,3000); retry.unref();
  });
  await client.query('LISTEN venue_catalogue_changed');
  for(const response of subscribers) response.write('data: connected\n\n');
 } catch { if(connection) {connection.release(true);connection=undefined;} retry=setTimeout(listen,3000);retry.unref(); }
 finally { connecting=false; }
}
// Opens a public invalidation stream and cleans up when the browser leaves the catalogue.
function catalogueStream(req,res) {
 res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
 res.flushHeaders(); res.write(': catalogue stream\n\n'); subscribers.add(res); listen();
 const heartbeat=setInterval(()=>res.write(': keep-alive\n\n'),25000); heartbeat.unref(); // Keeps the stream alive through idle proxies.
 req.on('close',()=> { // Releases resources when the last browser disconnects.
  clearInterval(heartbeat); subscribers.delete(res);
  if(!subscribers.size) {clearTimeout(retry);const client=connection;connection=undefined;if(client)client.query('UNLISTEN venue_catalogue_changed').catch(()=>{}).finally(()=>client.release());}
 });
}
module.exports={catalogueStream};
