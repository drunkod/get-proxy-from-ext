// e2e/proxy-schema.js
import { co, z } from "jazz-tools";

// === Server Data Schemas ===

// Since z.object and z.record aren't available, we'll use a different approach
// Store servers as a JSON string and parse it when needed

// === Message Types ===

// Message to send proxy data from client to server
export const ProxyDataMessage = co.map({
  type: z.literal("proxyData"),
  servers: z.string(), // JSON stringified servers object
  timestamp: z.string(),
  extensionId: z.string().optional(),
});

// Message to check proxy status
export const ProxyStatusMessage = co.map({
  type: z.literal("checkStatus"),
  currentTimestamp: z.string(),
});

// Message to request latest valid proxies
export const ProxyRequestMessage = co.map({
  type: z.literal("requestProxies"),
  includeExpired: z.boolean().optional(),
});

// Combined message type using discriminated union
export const ProxyMessage = co.discriminatedUnion("type", [
  ProxyDataMessage,
  ProxyStatusMessage,
  ProxyRequestMessage,
]);

// === Response Types ===

// Generic response for proxy data updates
export const ProxyDataResponse = co.map({
  id: z.string(),
  message: z.string(),
  savedCount: z.number(),
  timestamp: z.string(),
});

// Response for status checks
export const ProxyStatusResponse = co.map({
  needsUpdate: z.boolean(),
  validServers: z.number(),
  expiredServers: z.number(),
  totalServers: z.number(),
  lastUpdateTime: z.string().optional(),
  nextExpirationIn: z.number().optional(),
});

// Response with actual proxy data
export const ProxyListResponse = co.map({
  servers: z.string(), // JSON stringified servers
  validCount: z.number(),
  expiredCount: z.number(),
  retrievedAt: z.string(),
});

// === Storage Schemas ===

// Stored proxy configuration with metadata
export const ProxyConfig = co.map({
  servers: z.string(), // JSON stringified servers object
  timestamp: z.string(),
  expiresAt: z.string().optional(),
  extensionId: z.string().optional(),
  validServersCount: z.number(),
  totalServersCount: z.number(),
});

// V2Ray configuration template
export const V2RayConfig = co.map({
  generatedAt: z.string(),
  validProxies: z.number(),
  configJson: z.string(), // Stringified V2Ray JSON config
  serversList: z.string(), // JSON stringified array of servers
});

// === Account Root Schemas ===

// Stats sub-schema
export const StatsSchema = co.map({
  totalUpdates: z.number(),
  lastUpdateTime: z.string().optional(),
  totalProxiesEverSeen: z.number(),
});

// Server account root - stores all proxy data
export const ServerAccountRoot = co.map({
  configs: co.list(ProxyConfig),
  latestConfig: co.optional(ProxyConfig),
  v2rayConfigs: co.list(V2RayConfig),
  stats: co.optional(StatsSchema),
});

// Client account root - stores response IDs
export const ClientAccountRoot = co.map({
  responseIds: co.list(z.string()),
  lastRequestTime: z.string().optional(),
  requestCount: z.number().optional(),
});

// === Account Schemas ===

// Server account WITHOUT migration
export const ProxyServerAccount = co.account({
  profile: co.profile({ 
    name: z.string(),
    type: z.literal("proxyServer"),
    createdAt: z.string().optional(),
  }),
  root: ServerAccountRoot,
});

// Client account WITHOUT migration
export const ProxyClientAccount = co.account({
  profile: co.profile({ 
    name: z.string(),
    type: z.literal("proxyClient"),
    extensionId: z.string().optional(),
  }),
  root: ClientAccountRoot,
});

// === Helper Functions ===

// Parse servers from JSON string
export function parseServers(serversJson) {
  try {
    return JSON.parse(serversJson);
  } catch (error) {
    console.error('Failed to parse servers:', error);
    return {};
  }
}

// Calculate when the config expires based on shortest TTL
export function calculateExpiration(servers) {
  let shortestExpiration = null;
  const now = Date.now();
  
  for (const server of Object.values(servers)) {
    if (server.ttl && server.ttl > 0 && server.receivedTime) {
      // TTL is in MINUTES, not seconds!
      const expiresAt = server.receivedTime + (server.ttl * 60 * 1000); // Convert minutes to milliseconds
      if (!shortestExpiration || expiresAt < shortestExpiration) {
        shortestExpiration = expiresAt;
      }
    }
  }
  
  return shortestExpiration ? new Date(shortestExpiration).toISOString() : null;
}

// Filter out expired servers
export function getValidServers(servers) {
  const now = Date.now();
  const valid = {};
  
  for (const [key, server] of Object.entries(servers)) {
    if (!server.ttl || server.ttl === -1) {
      // Never expires
      valid[key] = server;
    } else if (server.receivedTime) {
      // TTL is in MINUTES
      const expiresAt = server.receivedTime + (server.ttl * 60 * 1000);
      if (expiresAt > now) {
        valid[key] = server;
      }
    } else {
      // No receivedTime, assume valid
      valid[key] = server;
    }
  }
  
  return valid;
}

// Check if a proxy config needs update
export function needsUpdate(config) {
  if (!config) return true;
  
  // Check if expired by time
  if (config.expiresAt && new Date(config.expiresAt) < new Date()) {
    return true;
  }
  
  // Check if any servers are expired
  const servers = parseServers(config.servers);
  const validServers = getValidServers(servers);
  return Object.keys(validServers).length < Object.keys(servers).length;
}

// Generate proxy summary
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
    // Count by country/name
    const country = server.name || key;
    summary.byCountry[country] = (summary.byCountry[country] || 0) + 1;
    
    // Count by protocol
    const protocol = server.host.includes("socks") ? "socks" : "http";
    summary.byProtocol[protocol]++;
  }
  
  return summary;
}