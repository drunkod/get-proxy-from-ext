// e2e/proxy-schema.js
import { co, z } from "jazz-tools";

// === Core Data Structures ===
export const ProxyConfig = co.map({
  servers: z.string(), // JSON stringified servers object
  timestamp: z.string(),
  expiresAt: z.string().optional(),
  extensionId: z.string().optional(),
  validServersCount: z.number(),
  totalServersCount: z.number(),
});

export const V2RayConfig = co.map({
  generatedAt: z.string(),
  validProxies: z.number(),
  configJson: z.string(),
  serversList: z.string(),
});

export const StatsSchema = co.map({
  totalUpdates: z.number(),
  lastUpdateTime: z.string().optional(),
  totalProxiesEverSeen: z.number(),
});

// === Messages Sent FROM Extension TO Server ===

// Extension announces its presence
export const ExtensionRegistration = co.map({
  type: z.literal("register"),
  extensionId: z.string(),
});

// Extension pushes new proxy data
export const ProxyUpdatePush = co.map({
  type: z.literal("push"),
  servers: z.string(), // JSON string
  timestamp: z.string(),
  extensionId: z.string(),
});

// All possible messages the server can receive
export const ServerBoundMessage = co.discriminatedUnion("type", [
  ExtensionRegistration, // <-- FIX: Add ExtensionRegistration to the union
  ProxyUpdatePush,
]);

// === Account Schemas ===
export const ServerAccountRoot = co.map({
  configs: co.list(ProxyConfig),
  latestConfig: co.optional(ProxyConfig),
  v2rayConfigs: co.list(V2RayConfig),
  stats: co.optional(StatsSchema),
  connectedExtensions: co.optional(co.map({})), // Simple empty map for dynamic key-value pairs
});

export const ClientAccountRoot = co.map({
  lastPushTime: z.string().optional(),
  pushCount: z.number().optional(),
});

export const ProxyServerAccount = co.account({
  profile: co.profile({ 
    name: z.string(),
    type: z.literal("proxyServer").optional(),
  }),
  root: ServerAccountRoot,
});

export const ProxyClientAccount = co.account({
  profile: co.profile({ 
    name: z.string(),
    type: z.literal("proxyClient").optional(),
  }),
  root: ClientAccountRoot,
});

// === Helper Functions ===
export function parseServers(serversJson) {
  try {
    return JSON.parse(serversJson);
  } catch (error) {
    console.error('Failed to parse servers:', error);
    return {};
  }
}

export function calculateExpiration(servers) {
  let shortestExpiration = null;
  const now = Date.now();
  
  for (const server of Object.values(servers)) {
    if (server.ttl && server.ttl > 0 && server.receivedTime) {
      const expiresAt = server.receivedTime + (server.ttl * 60 * 1000);
      if (!shortestExpiration || expiresAt < shortestExpiration) {
        shortestExpiration = expiresAt;
      }
    }
  }
  
  return shortestExpiration ? new Date(shortestExpiration).toISOString() : null;
}

export function getValidServers(servers) {
  const now = Date.now();
  const valid = {};
  
  for (const [key, server] of Object.entries(servers)) {
    if (!server.ttl || server.ttl === -1) {
      valid[key] = server;
    } else if (server.receivedTime) {
      const expiresAt = server.receivedTime + (server.ttl * 60 * 1000);
      if (expiresAt > now) {
        valid[key] = server;
      }
    } else {
      valid[key] = server;
    }
  }
  
  return valid;
}

export function needsUpdate(config) {
  if (!config) return true;
  
  if (config.expiresAt && new Date(config.expiresAt) < new Date()) {
    return true;
  }
  
  const servers = parseServers(config.servers);
  const validServers = getValidServers(servers);
  return Object.keys(validServers).length < Object.keys(servers).length;
}

export function generateProxySummary(serversJson) {
  const servers = parseServers(serversJson);
  const validServers = getValidServers(servers);
  const summary = {
    total: Object.keys(servers).length,
    valid: Object.keys(validServers).length,
    expired: Object.keys(servers).length - Object.keys(validServers).length,
    byCountry: {},
    byProtocol: { http: 0, socks: 0 },
  };
  
  for (const [key, server] of Object.entries(validServers)) {
    const country = server.name || key;
    summary.byCountry[country] = (summary.byCountry[country] || 0) + 1;
    
    const protocol = server.host.includes("socks") ? "socks" : "http";
    summary.byProtocol[protocol]++;
  }
  
  return summary;
}