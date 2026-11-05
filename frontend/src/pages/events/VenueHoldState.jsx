import {useEffect,useState} from 'react';
/** SCRUM-85 AC7/AC8: displays the current booking's capitalized hold state and updates at its saved expiry. */
export default function VenueHoldState({booking}){
 const [now,setNow]=useState(Date.now());
 const expiry=Date.parse(booking.hold_expires_at);
 useEffect(()=>{
  setNow(Date.now());
  // Pending requests and staff-approved tentative holds use the same saved deadline.
  // One deadline timer avoids polling while keeping an already-open event accurate at expiry.
  if(!['pending','tentative'].includes(booking.status)||!Number.isFinite(expiry)||expiry<=Date.now())return undefined;
  const timer=setTimeout(()=>setNow(Date.now()),Math.min(expiry-Date.now(),2147483647));
  return()=>clearTimeout(timer);
 },[booking.status,expiry]);
 const state=!['pending','tentative'].includes(booking.status)?booking.status:!Number.isFinite(expiry)?'No active hold':expiry<=now?'Expired':'Held';
 // Database decisions are lowercase; all visible states use the same initial-capital presentation.
 const stateLabel=state.charAt(0).toUpperCase()+state.slice(1);
 return <p><strong>Hold state:</strong> {stateLabel}{state==='Held'&&` until ${new Date(expiry).toLocaleString('en-SG',{timeZone:'Asia/Singapore'})}`}</p>;
}
