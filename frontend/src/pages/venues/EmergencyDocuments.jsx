// File: Provides optional emergency procedure and floor-plan downloads and staff upload controls.
import {useState} from 'react';
import {readAttachment} from '../../components/EventAttachments';
const documents=[['procedure','Emergency procedure','.pdf'],['floorPlan','Evacuation floor plan','.pdf,.png,.jpg,.jpeg']];

/** Shows saved documents; an onChange callback enables replacement/removal, with reading reported to the form. */
export default function EmergencyDocuments({value={},onChange,onBusy}) {
  const [reading,setReading]=useState(false),[error,setError]=useState('');
  /** Retains the previous document on failure and clears the input so selecting the same file can retry. */
  async function select(key,file,input) {
    if(!file)return;
    setError('');setReading(true);onBusy(true);
    try {
      const allowed=key==='procedure'?/\.pdf$/i:/\.(pdf|png|jpe?g)$/i;
      if(!allowed.test(file.name))throw new Error(key==='procedure'?'Choose a PDF emergency procedure.':'Choose a PDF, PNG or JPEG floor plan.');
      const next=await readAttachment(file);
      onChange(key,next);
    } catch(err){setError(err.message);}
    finally {input.value='';setReading(false);onBusy(false);}
  }
  return <section className="emergency-documents" aria-label="Emergency documents">
    <h3>Emergency documents</h3><p className="field-help">Upload the venue’s emergency procedure and evacuation floor plan. Each file is optional and can be up to 2 MB. Save the venue to publish changes.</p>
    <div className="form-grid">{documents.map(([key,label,accept])=><div className="emergency-document" key={key}>
      <h4>{label}</h4>
      {onChange && <label className="upload-field">{value[key]?'Replace':'Upload'} {label.toLowerCase()}<input type="file" aria-label={`${value[key]?'Replace':'Upload'} ${label.toLowerCase()}`} accept={accept} disabled={reading} onChange={event=>select(key,event.target.files?.[0],event.target)}/><span>{key==='procedure'?'PDF':'PDF, PNG or JPEG'} · up to 2 MB</span></label>}
      {value[key]?<div className="emergency-document-actions"><a className="button-secondary" download={value[key].name} href={`data:${value[key].type || (value[key].name.toLowerCase().endsWith('.pdf')?'application/pdf':'application/octet-stream')};base64,${value[key].data}`}>Download {label.toLowerCase()}: {value[key].name}</a>
        {onChange && <button type="button" className="button-secondary" disabled={reading} onClick={()=>onChange(key,null)}>Remove {label.toLowerCase()}</button>}</div>:<p className="muted">No {label.toLowerCase()} uploaded.</p>}
    </div>)}</div>
    {reading && <p role="status">Reading document…</p>}{error && <p role="alert" className="error-message">{error}</p>}
  </section>;
}
