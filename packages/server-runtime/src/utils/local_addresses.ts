import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'

/**
 * Collects local IP addresses that can be used to reach the server from the LAN.
 *
 * Use when:
 * - Building connection hints for `0.0.0.0` listeners
 * - Showing reachable addresses in logs or UI
 *
 * Expects:
 * - Virtual interfaces should be ignored.
 *
 * Returns:
 * - A de-duplicated list of valid IP addresses discovered from the host network interfaces
 */
export function getLocalIPs(): string[] {
  const interfaces = networkInterfaces()
  const addresses = new Set<string>()

  const VIRTUAL_INTERFACE_PREFIXES = [
    'vboxnet',
    'vmnet',
    'docker',
    'br-',
    'veth',
    'utun',
    'wg',
    'tap',
    'tun',
  ]
  const isVirtualInterface = (name: string) =>
    VIRTUAL_INTERFACE_PREFIXES.some(prefix => name.startsWith(prefix))

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries)
      continue
    if (isVirtualInterface(name))
      continue

    for (const entry of entries) {
      const rawAddress = entry.address
      if (!rawAddress)
        continue

      const address = rawAddress.includes('%') ? rawAddress.split('%')[0] : rawAddress
      if (isIP(address))
        addresses.add(address)
    }
  }

  return [...addresses]
}
