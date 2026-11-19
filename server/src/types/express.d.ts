import type { DeviceRecord } from '../services/devices.js';

declare global {
  namespace Express {
    interface Request {
      admin?: {
        id: string;
        email: string;
        name: string;
        role: 'admin' | 'operator';
      };
      device?: DeviceRecord;
    }
  }
}

export {};
