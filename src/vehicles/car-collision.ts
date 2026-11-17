/** Root-space contact shapes, including the visible mirrors outside the cabin.
 * The shell rests 18 cm below the vehicle root on level suspension. */
export const CAR_MIRRORS=[-1,1].map(side=>({center:{x:side*1.035,y:.08,z:-.81},half:{x:.10,y:.07,z:.12}}));
export const CAR_CONTACT_BOXES=[{center:{x:0,y:.08,z:-.13},half:{x:.88,y:.55,z:2.05}},...[-2.2,2.2].map(z=>({center:{x:0,y:-.36,z},half:{x:.86,y:.14,z:.15}}))];
export const CAR_CLEARANCE_BOXES=[{center:{x:0,y:0,z:0},half:{x:.97,y:.8,z:2.35}},...CAR_MIRRORS];
export const CAR_ROOF_BOXES=[{center:{x:0,y:.63,z:.39},half:{x:.85,y:.0425,z:.97}},...[-1,1].map(side=>({center:{x:side*.57,y:.72,z:.35},half:{x:.0175,y:.02,z:.725}}))];
