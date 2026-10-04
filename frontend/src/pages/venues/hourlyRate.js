// File: Converts recorded hourly amounts into consistent numeric form values and catalogue labels.
// Reads numeric amounts and unambiguous legacy currency labels; descriptive prices require staff review.
export function hourlyRateValue(value) {
 const text=String(value??'').trim();
 const match=/^(?:S?\$\s*)?((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?)(?:\s*\/hr)?$/i.exec(text);
 if(!match)return '';
 const amount=Number(match[1].replaceAll(',',''));
 return Number.isFinite(amount) && amount<=99999999.99 ? String(amount) : '';
}
// Displays the Singapore-dollar hourly rate without mistaking descriptive legacy pricing for an amount.
export function formatHourlyRate(value) {
 const amount=hourlyRateValue(value);
 if(amount==='')return 'Hourly rate not set';
 return `$${Number(amount).toLocaleString('en-SG',{minimumFractionDigits:Number(amount)%1?2:0,maximumFractionDigits:2})}/hr`;
}
