import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCorsOrigins } from "../env.js";
import { getNetworkAddresses } from "./network.js";

describe("getNetworkAddresses", () => {
  it("returns at least one IPv4 address when the machine has a network interface", () => {
    const addresses = getNetworkAddresses();
    assert.ok(addresses.length > 0, "Expected at least one network address");
    assert.ok(
      addresses.some((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)),
      `Expected IPv4 addresses, got: ${addresses.join(", ")}`,
    );
  });
});

describe("getCorsOrigins", () => {
  it("parses multiple comma-separated origins and keeps the configured frontend URL", () => {
    const origins = getCorsOrigins(
      "https://ticketmanagement.site, https://www.ticketmanagement.site, http://localhost:1020, https://backend.ticketmanagement.site:1019",
      "https://ticketmanagement.site",
    );

    assert.deepEqual(origins, [
      "https://ticketmanagement.site",
      "https://www.ticketmanagement.site",
      "https://ticketmanagement.site:1020",
      "https://www.ticketmanagement.site:1020",
      "http://localhost:1020",
      "http://localhost:5173",
      "https://localhost:1020",
      "http://192.168.12.27:1020",
      "https://backend.ticketmanagement.site:1019",
    ]);
  });
});
