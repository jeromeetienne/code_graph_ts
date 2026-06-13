import type { Hardware } from '../types/capacity.js';

/** Single-server CPU budget in CPU-milliseconds per second (≈ 1000 per core). */
export const MAX_CPU_MILLIS = Number(process.env.MAX_CPU_MILLIS ?? '4000');

/** Single-server network budget in kilobytes per second. */
export const MAX_NETWORK_KBPS = Number(process.env.MAX_NETWORK_KBPS ?? '125000');

/** Single-server disk budget in I/O operations per second. */
export const MAX_DISK_IOPS = Number(process.env.MAX_DISK_IOPS ?? '8000');

/** Assemble one server's per-dimension hardware capacity from the environment. */
export function loadHardware(): Hardware {
	return {
		cpu: MAX_CPU_MILLIS,
		network: MAX_NETWORK_KBPS,
		disk: MAX_DISK_IOPS,
	};
}
