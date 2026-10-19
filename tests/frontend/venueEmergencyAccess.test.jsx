// Sprint 3 SCRUM-98: real venue creation and profile components; only session, API and external map boundaries are mocked.
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AddVenueModal from '../../frontend/src/pages/venues/AddVenueModal';
import VenueDetail from '../../frontend/src/pages/venues/VenueDetail';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: () => ({ token: 'venue-staff' }) }));
vi.mock('../../frontend/src/api/client', () => ({ api: { post: vi.fn(), put: vi.fn() } }));
// Location resolution and map tiles are external to recording safety information.
vi.mock('../../frontend/src/pages/venues/LocationPicker', () => ({ default: ({ onChange }) =>
  <button type="button" onClick={() => onChange({ location: 'Marina Road', latitude: 1.3, longitude: 103.85 })}>Choose venue location</button> }));
vi.mock('../../frontend/src/pages/venues/VenueMap', () => ({ default: () => null }));

const details = 'Emergency exits: north stairwell on Level 1 and east lobby.\nEmergency vehicle access: loading gate on Marina Road.\nEvacuation route: east lobby to assembly area A.\nRestrictions/obstructions: loading gate height 3 metres; keep the access lane clear.';
const savedVenue = { id: 98, name: 'Safety Hall', emergency_access: details };
beforeEach(() => { vi.resetAllMocks(); api.post.mockResolvedValue({ venue: savedVenue }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Arranges the required existing venue facts without bypassing the production form validation. */
function fillVenue() {
  for (const [label, value] of Object.entries({ 'Venue name *': 'Safety Hall', 'Capacity *': '80',
    'Supported room layouts *': 'Theatre', 'Facilities & amenities *': 'Projector', 'Accessibility features *': 'Ramp' })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Choose venue location' }));
}

// AC1/AC2: the request must contain all four safety facts, and the returned profile must retain their line breaks.
it('SCRUM-98 AC1 AC2 - creates a venue with all emergency access details and displays the saved multiline information', async () => {
  const onAdd = vi.fn();
  const view = render(<AddVenueModal onAdd={onAdd} onClose={vi.fn()} />);
  fillVenue();
  const field = screen.getByRole('textbox', { name: 'Emergency access' });
  expect(field).toHaveAccessibleDescription(/emergency exits and their locations.*emergency vehicle access points.*evacuation routes.*restrictions or obstructions/i);
  fireEvent.change(field, { target: { value: `  ${details}  ` } });
  fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/venues', expect.objectContaining({ emergencyAccess: details }), 'venue-staff'));
  expect(onAdd).toHaveBeenCalledWith(savedVenue);
  view.unmount();
  render(<VenueDetail venue={savedVenue} onClose={vi.fn()} />);
  expect(screen.getByText('Emergency access', { selector: 'dt' }).nextElementSibling.textContent).toBe(details);
});

// Upload AC: real FileReader reads browser files; only HTTP persistence is mocked.
it('SCRUM-98 upload AC - saves both documents and downloads the exact returned files from the venue record',async()=>{
  const procedure=new File(['%PDF-1.7\nEmergency procedures'],'procedure.pdf',{type:'application/pdf'});
  const floorPlan=new File(['%PDF-1.7\nFloor plan'],'floor.pdf',{type:'application/pdf'});
  const documents={procedure:{name:procedure.name,type:'application/pdf',data:btoa('%PDF-1.7\nEmergency procedures')},floorPlan:{name:floorPlan.name,type:'application/pdf',data:btoa('%PDF-1.7\nFloor plan')}};
  api.post.mockResolvedValueOnce({venue:{...savedVenue,emergency_documents:documents}});
  const onAdd=vi.fn(),view=render(<AddVenueModal onClose={vi.fn()} onAdd={onAdd}/>);fillVenue();
  fireEvent.change(screen.getByLabelText('Upload emergency procedure'),{target:{files:[procedure]}});
  await screen.findByRole('link',{name:/Download emergency procedure/});
  fireEvent.change(screen.getByLabelText('Upload evacuation floor plan'),{target:{files:[floorPlan]}});
  await screen.findByRole('link',{name:/Download evacuation floor plan/});
  fireEvent.click(screen.getByRole('button',{name:'Save & Publish Venue'}));
  await waitFor(()=>expect(api.post).toHaveBeenCalledWith('/venues',expect.objectContaining({emergencyDocuments:{procedure:{name:procedure.name,data:documents.procedure.data},floorPlan:{name:floorPlan.name,data:documents.floorPlan.data}}}),'venue-staff'));
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({emergency_documents:documents}));
  view.unmount();render(<VenueDetail venue={{...savedVenue,emergency_documents:documents}} onClose={vi.fn()}/>);
  for(const [key,file] of Object.entries(documents))expect(screen.getByRole('link',{name:new RegExp(file.name)})).toHaveAttribute('href',`data:application/pdf;base64,${documents[key].data}`);
  expect(screen.queryByLabelText(/Upload/)).not.toBeInTheDocument();
});

// Upload AC: editing must preserve untouched files while explicitly removing one and replacing the other.
it('SCRUM-98 upload AC - replaces a floor plan, removes a procedure and keeps changes after save failure for retry',async()=>{
  const stored={procedure:{name:'old.pdf',type:'application/pdf',data:'JVBERi0='},floorPlan:{name:'old.png',type:'image/png',data:'aW1hZ2U='}};
  api.put.mockRejectedValueOnce(new Error('Save failed')).mockResolvedValueOnce({venue:savedVenue});
  render(<AddVenueModal venue={{...savedVenue,emergency_documents:stored}} onClose={vi.fn()}/>);fillVenue();
  fireEvent.click(screen.getByRole('button',{name:'Remove emergency procedure'}));
  fireEvent.change(screen.getByLabelText('Replace evacuation floor plan'),{target:{files:[new File([new Uint8Array([255,216,255])],'replacement.jpeg',{type:'image/jpeg'})]}});
  await screen.findByRole('link',{name:/replacement.jpeg/});
  fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
  expect(await screen.findByText('Save failed')).toBeVisible();
  expect(screen.getByRole('link',{name:/replacement.jpeg/})).toHaveAttribute('href','data:application/octet-stream;base64,/9j/');
  fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
  await waitFor(()=>expect(api.put).toHaveBeenCalledTimes(2));
  expect(api.put).toHaveBeenLastCalledWith('/venues/98',expect.objectContaining({emergencyDocuments:{procedure:null,floorPlan:{name:'replacement.jpeg',data:'/9j/'}}}),'venue-staff');
});

// Upload AC: cancellation and invalid files cannot discard a previously selected document.
it('SCRUM-98 upload AC - rejects incorrect formats and supports retry after a browser read error',async()=>{
  const stored={procedure:{name:'existing.pdf',type:'application/pdf',data:'JVBERi0='}};
  render(<AddVenueModal venue={{...savedVenue,emergency_documents:stored}} onClose={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Replace emergency procedure'),{target:{files:[]}});
  fireEvent.change(screen.getByLabelText('Replace emergency procedure'),{target:{files:[new File(['x'],'plan.png')]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PDF emergency procedure.');
  fireEvent.change(screen.getByLabelText('Upload evacuation floor plan'),{target:{files:[new File(['x'],'plan.doc')]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PDF, PNG or JPEG floor plan.');
  const NativeReader=globalThis.FileReader;
  vi.stubGlobal('FileReader',class {readAsDataURL(){this.onerror();}});
  fireEvent.change(screen.getByLabelText('Replace emergency procedure'),{target:{files:[new File(['%PDF-'],'retry.pdf')]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to read this file.');
  expect(screen.getByRole('link',{name:/existing.pdf/})).toBeVisible();
  vi.stubGlobal('FileReader',NativeReader);
  fireEvent.change(screen.getByLabelText('Replace emergency procedure'),{target:{files:[new File(['%PDF-'],'retry.pdf')]}});
  expect(await screen.findByRole('link',{name:/retry.pdf/})).toHaveAttribute('download','retry.pdf');
});

// Upload AC: save must not race a pending file read, even if submit is triggered programmatically.
it('SCRUM-98 upload AC - prevents saving until a pending document read finishes',async()=>{
  let reader;
  vi.stubGlobal('FileReader',class {constructor(){reader=this;} readAsDataURL(){}});
  render(<AddVenueModal onClose={vi.fn()}/>);fillVenue();
  fireEvent.change(screen.getByLabelText('Upload evacuation floor plan'),{target:{files:[new File([new Uint8Array([137,80,78,71,13,10,26,10])],'plan.png')]}});
  expect(screen.getByRole('status')).toHaveTextContent('Reading document');
  expect(screen.getByRole('button',{name:'Save & Publish Venue'})).toBeDisabled();
  fireEvent.submit(screen.getByRole('button',{name:'Save & Publish Venue'}).closest('form'));
  expect(api.post).not.toHaveBeenCalled();
  await act(async()=>{reader.result='data:image/png;base64,iVBORw0KGgo=';reader.onload();});
  expect(screen.getByRole('button',{name:'Save & Publish Venue'})).toBeEnabled();
});

// Upload AC: verify below, exactly at and above the browser's per-file limit.
it.each([2097151,2097152,2097153])('SCRUM-98 upload AC - validates a %i byte document before saving',async size=>{
  render(<AddVenueModal onClose={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Upload emergency procedure'),{target:{files:[new File([new Uint8Array(size)],'plan.pdf')]}});
  if(size>2097152){expect(await screen.findByRole('alert')).toHaveTextContent('up to 2 MB');expect(screen.queryByRole('link')).not.toBeInTheDocument();}
  else expect(await screen.findByRole('link',{name:/plan.pdf/})).toHaveAttribute('download','plan.pdf');
});

// AC1: recording details is optional, so omitting them cannot silently make venue creation compulsory.
it.each(['', '   '])('SCRUM-98 AC1 - allows an optional emergency access value of %j', async value => {
  render(<AddVenueModal onClose={vi.fn()} />);
  fillVenue();
  expect(screen.getByLabelText('Emergency access')).not.toBeRequired();
  fireEvent.change(screen.getByLabelText('Emergency access'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/venues', expect.objectContaining({ emergencyAccess: null }), 'venue-staff'));
});

// AC1: a failed creation preserves the safety draft so staff can retry without re-entering operational information.
it('SCRUM-98 AC1 - preserves emergency access details after a failed creation and retries successfully', async () => {
  api.post.mockRejectedValueOnce(new Error('Venue could not be saved'));
  const onAdd = vi.fn();
  render(<AddVenueModal onAdd={onAdd} onClose={vi.fn()} />);
  fillVenue();
  fireEvent.change(screen.getByLabelText('Emergency access'), { target: { value: details } });
  fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Venue could not be saved');
  expect(screen.getByLabelText('Emergency access')).toHaveValue(details);
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith(savedVenue));
});

// AC1: the existing storage limit is exercised below, at and above its boundary through the creation control itself.
it.each([1999, 2000, 2001])('SCRUM-98 AC1 - validates %i emergency access characters before creating a venue', async length => {
  render(<AddVenueModal onClose={vi.fn()} />);
  fillVenue();
  fireEvent.change(screen.getByLabelText('Emergency access'), { target: { value: 'x'.repeat(length) } });
  fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
  if (length > 2000) {
    expect(screen.getByText('Enter at most 2000 characters.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Emergency access/ })).toHaveAttribute('aria-invalid', 'true');
    expect(api.post).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/venues', expect.objectContaining({ emergencyAccess: 'x'.repeat(length) }), 'venue-staff'));
  }
});
