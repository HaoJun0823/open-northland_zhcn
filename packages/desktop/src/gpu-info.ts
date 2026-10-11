/** Hex digits of a PCI vendor or device id. */
const PCI_ID_DIGITS = 4;
const HEX = 16;

interface GpuDevice {
  readonly vendorId: number;
  readonly deviceId: number;
  readonly active: boolean;
  readonly deviceString: string | null;
}

function deviceOf(entry: unknown): GpuDevice | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { vendorId, deviceId, active, deviceString } = entry as Record<string, unknown>;
  if (typeof vendorId !== 'number' || typeof deviceId !== 'number') return null;
  return {
    vendorId,
    deviceId,
    active: active === true,
    deviceString: typeof deviceString === 'string' && deviceString.length > 0 ? deviceString : null,
  };
}

const pciId = (id: number): string => id.toString(HEX).padStart(PCI_ID_DIGITS, '0');

/**
 * One line naming the GPUs Chromium found in `app.getGPUInfo('basic')`, the one its GPU process
 * runs on marked active, so a report from a dual-GPU laptop says which adapter drew.
 */
export function describeGpuInfo(info: unknown): string {
  const list =
    typeof info === 'object' && info !== null && 'gpuDevice' in info && Array.isArray(info.gpuDevice)
      ? info.gpuDevice
      : [];
  const devices = list.map(deviceOf).filter((device) => device !== null);
  if (devices.length === 0) return 'GPU: unknown';
  const named = devices.map((device) => {
    const id = `${pciId(device.vendorId)}:${pciId(device.deviceId)}`;
    const name = device.deviceString === null ? id : `${device.deviceString} (${id})`;
    return device.active ? `${name} active` : name;
  });
  return `GPU: ${named.join(', ')}`;
}
