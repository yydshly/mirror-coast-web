import type { Quat, Vec3 } from '../destruction/types';
import type {ReturnPhase} from './return-flight';

export type HelicopterState = {
  position: Vec3;
  rotation: Quat;
  linearVelocity: Vec3;
  engineOn: boolean;
  routeIndex: number;
  /** Optional for schema-1 compatibility. Active tours resume after loading. */
  tourStatus?: 'idle' | 'active' | 'paused' | 'complete';
  flightMode?:'tour'|'return';
};

export type HelicopterViewState = {
  piloting: boolean;
  autopilot: boolean;
  engineOn: boolean;
  rpm: number;
  speed: number;
  altitude: number;
  grounded: boolean;
  routeIndex: number;
  waypoint: string;
  routeComplete: boolean;
  tourStatus: 'idle' | 'active' | 'paused' | 'complete';
  waypointDistance: number;
  flightMode?:'tour'|'return';
  returnPhase?:ReturnPhase;
  returnAltitude?:number;
};
