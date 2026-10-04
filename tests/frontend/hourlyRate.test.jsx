// File: Verifies hourly pricing display, legacy numeric labels and invalid-rate form feedback.
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {formatHourlyRate,hourlyRateValue} from '../../frontend/src/pages/venues/hourlyRate';
import VenueDetail from '../../frontend/src/pages/venues/VenueDetail';
import AddVenueModal from '../../frontend/src/pages/venues/AddVenueModal';
vi.mock('../../frontend/src/context/AuthContext',()=>({useAuth:()=>({token:'staff-token'})})); // Supplies a staff session for the isolated venue form.
vi.mock('../../frontend/src/pages/venues/LocationPicker',()=>({default:()=>null})); // Avoids provider calls in pricing-only tests.
vi.mock('../../frontend/src/api/client',()=>({api:{post:vi.fn(),put:vi.fn()}})); // Keeps validation tests free of real writes.
afterEach(cleanup); // Removes dialog portals after each check.
it('formats rates consistently and distinguishes missing or descriptive legacy prices',()=> {
 expect(formatHourlyRate('500.00')).toBe('$500/hr');expect(formatHourlyRate('75.50')).toBe('$75.50/hr');expect(formatHourlyRate('0')).toBe('$0/hr');
 expect(formatHourlyRate('S$500')).toBe('$500/hr');expect(formatHourlyRate('$1,200/hr')).toBe('$1,200/hr');
 expect(hourlyRateValue('S$500')).toBe('500');expect(formatHourlyRate('from S$500')).toBe('Hourly rate not set');expect(formatHourlyRate(null)).toBe('Hourly rate not set');
 expect(hourlyRateValue('100000000')).toBe('');expect(hourlyRateValue('9'.repeat(400))).toBe('');
});
it('venue details label the amount as hourly and append the per-hour unit',()=> {
 render(<VenueDetail venue={{name:'Hall',pricing:'75.50'}} onClose={()=>{}}/>);
 expect(screen.getByText('Hourly rate')).toBeTruthy();expect(screen.getByText('$75.50/hr')).toBeTruthy();
});
it('negative or over-precise hourly rates cannot be submitted',()=> {
 render(<AddVenueModal onClose={()=>{}}/>);
 const rate=screen.getByPlaceholderText('Hourly rate (e.g. 500)');
 for(const value of ['-1','1.234']) {fireEvent.change(rate,{target:{value}});fireEvent.click(screen.getByRole('button',{name:'Save & Publish Venue'}));expect(screen.getByText('Enter a non-negative hourly rate with up to two decimal places.')).toBeTruthy();}
});
