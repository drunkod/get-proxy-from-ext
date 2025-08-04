// e2e/server-modules/v2ray.js
import { V2RayConfig, parseServers, getValidServers } from "../proxy-schema.js";

/**
 * Generates and saves a V2Ray configuration based on the latest valid proxy servers.
 * @param {object} worker - The Jazz worker instance.
 * @param {object} account - The server's Jazz account object.
 * @param {object} rootGroup - The public group that owns the data.
 */
export async function generateV2RayConfiguration(worker, account, rootGroup) {
  if (!account.root.latestConfig) {
      console.log("   ⚠️ No latestConfig found, skipping V2Ray generation.");
      return;
  };

  const servers = parseServers(account.root.latestConfig.servers);
  const validServers = getValidServers(servers);

  const v2rayConfig = {
    log: { loglevel: "warning" },
    inbounds: [
      { port: 1080, listen: "127.0.0.1", protocol: "socks", settings: { auth: "noauth", udp: true } },
      { port: 8001, listen: "127.0.0.1", protocol: "http" }
    ],
    outbounds: [],
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: [{ type: "field", ip: ["geoip:private"], outboundTag: "direct" }]
    }
  };

  for (const [key, server] of Object.entries(validServers)) {
    v2rayConfig.outbounds.push({
      protocol: server.host.includes("socks") ? "socks" : "http",
      settings: { servers: [{ address: server.host, port: server.port }] },
      tag: `proxy-${key}`,
      streamSettings: { network: "tcp" }
    });
  }

  v2rayConfig.outbounds.push({ protocol: "freedom", tag: "direct" });

  if (v2rayConfig.outbounds.length > 1) {
    v2rayConfig.routing.rules.push({
      type: "field",
      outboundTag: v2rayConfig.outbounds[0].tag
    });
  }

  // CRITICAL FIX: Create the V2RayConfig with the public rootGroup as the owner
  const v2rayConfigRecord = V2RayConfig.create({
    generatedAt: new Date().toISOString(),
    validProxies: Object.keys(validServers).length,
    configJson: JSON.stringify(v2rayConfig, null, 2),
    serversList: JSON.stringify(Object.values(validServers)),
  }, { owner: rootGroup }); // <-- USE THE PUBLIC GROUP

  account.root.v2rayConfigs.push(v2rayConfigRecord);
  await account.root.v2rayConfigs.waitForSync();

  console.log(`   ✅ V2Ray config generated with ${Object.keys(validServers).length} proxies`);
}
