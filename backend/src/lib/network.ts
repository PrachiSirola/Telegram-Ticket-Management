import os from "node:os";

export function getNetworkAddresses(): string[] {
  const addresses = new Set<string>();

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry.internal && entry.family === "IPv4") {
        addresses.add(entry.address);
      }
    }
  }

  return [...addresses];
}

export function getPrimaryNetworkAddress(): string | undefined {
  const addresses = getNetworkAddresses();
  return addresses.find((address) => !address.startsWith("127.")) ?? addresses[0];
}
