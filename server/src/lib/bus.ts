import { EventEmitter } from 'node:events';

export type RealtimeEvent =
  | { type: 'spin:created'; payload: unknown }
  | { type: 'spin:completed'; payload: unknown }
  | { type: 'spin:updated'; payload: unknown }
  | { type: 'device:heartbeat'; payload: unknown }
  | { type: 'settings:updated'; payload: unknown }
  | { type: 'data:changed'; payload: { entity: string } };

class Bus extends EventEmitter {}

export const bus = new Bus();
bus.setMaxListeners(200);

export function broadcast(event: RealtimeEvent): void {
  bus.emit('event', event);
}
