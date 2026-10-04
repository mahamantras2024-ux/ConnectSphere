// File: Tests real map component lifecycle and coordinate callbacks without downloading external map tiles.
import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import VenueMap from '../../frontend/src/pages/venues/VenueMap';
const fixture=vi.hoisted(()=>({maps:[],markers:[]}));
vi.mock('leaflet',()=>({default:{
 map:vi.fn(()=>{const instance={setView:vi.fn(function(){return this;}),on:vi.fn(),invalidateSize:vi.fn(),remove:vi.fn()};fixture.maps.push(instance);return instance;}),
 tileLayer:vi.fn(()=>({addTo:vi.fn()})),
 circleMarker:vi.fn(()=>{const marker={addTo:vi.fn(function(){return this;}),remove:vi.fn()};fixture.markers.push(marker);return marker;})
}}));
beforeEach(()=>{fixture.maps.length=0;fixture.markers.length=0;vi.useFakeTimers();});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it('read-only maps initialize without a marker and resize after drawer animation',()=>{
 vi.stubGlobal('ResizeObserver',undefined);const view=render(<VenueMap/>);expect(screen.getByRole('region').getAttribute('aria-label')).toBe('Venue location map');expect(fixture.markers).toHaveLength(0);
 act(()=>vi.advanceTimersByTime(300));expect(fixture.maps[0].invalidateSize).toHaveBeenCalledOnce();
 fixture.maps[0].on.mock.calls[0][1]({latlng:{lat:1.3,lng:103.85}});view.unmount();expect(fixture.maps[0].remove).toHaveBeenCalledOnce();
});
it('map clicks use the current callback, marker changes remove old markers and observers release resources',()=>{
 let observer,callback;class Observer{constructor(action){observer=this;callback=action;}observe=vi.fn();disconnect=vi.fn();}
 vi.stubGlobal('ResizeObserver',Observer);const first=vi.fn(),next=vi.fn();const view=render(<VenueMap latitude={1.296} longitude={103.85} onPick={first}/>);
 expect(screen.getByRole('region').getAttribute('aria-label')).toBe('Choose venue location on map');expect(fixture.markers).toHaveLength(1);expect(observer.observe).toHaveBeenCalledOnce();act(()=>callback());expect(fixture.maps[0].invalidateSize).toHaveBeenCalledOnce();
 view.rerender(<VenueMap latitude={1.3} longitude={103.86} onPick={next}/>);expect(fixture.markers[0].remove).toHaveBeenCalledOnce();expect(fixture.markers).toHaveLength(2);
 act(()=>fixture.maps[0].on.mock.calls[0][1]({latlng:{lat:1.3,lng:103.86}}));expect(next).toHaveBeenCalledWith({latitude:1.3,longitude:103.86});expect(first).not.toHaveBeenCalled();view.unmount();expect(observer.disconnect).toHaveBeenCalledOnce();
});
it('partial coordinates do not create a fictitious venue marker',()=>{
 render(<VenueMap latitude={1.3}/>);expect(fixture.markers).toHaveLength(0);
});
