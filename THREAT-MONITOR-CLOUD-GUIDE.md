# Threat Monitor — Cloud-Side Integration Guide

## Overview

The DustForge agent now includes a background network threat monitor that checks active TCP connections and DNS cache entries against a blacklist of known-malicious IPs, domains, and CIDR ranges. The cloud server controls this feature via two new commands and receives results through three channels.

## How It Works

1. **Server sends `update-threat-blacklist` command** with a URL pointing to a blacklist JSON file
2. **Agent downloads the blacklist**, validates it, and stores it locally
3. **Agent begins scanning** — TCP connections every 15s, DNS cache every 60s
4. **Three reporting channels:**
   - **Immediate alert** — `POST /api/devices/{deviceId}/threat-alert` fires within seconds of detection
   - **Telemetry** — `threatSnapshot` included in regular telemetry (default every 60s)
   - **On-demand** — `get-threat-status` command returns current state (can be polled as often as needed)

The monitor starts automatically when the agent connects to the cloud (if a blacklist exists on disk from a previous update). If no blacklist has ever been pushed, the monitor is idle until one is sent.

---

## Step 1: Host Your Blacklist

Create a JSON file with this exact structure and host it at an HTTPS URL accessible to the agent:

```json
{
  "version": "2026-03-13-001",
  "updatedAt": "2026-03-13T00:00:00Z",
  "domains": [
    "malware-c2.example.com",
    "botnet-controller.bad.net",
    "ransomware-keygen.evil.org"
  ],
  "ips": [
    "198.51.100.1",
    "203.0.113.42",
    "2001:db8::dead:beef"
  ],
  "cidrs": [
    "192.0.2.0/24",
    "198.51.100.0/24",
    "2001:db8::/32"
  ]
}
```

### Field Requirements

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `version` | string | Yes | 1–100 chars. Use for tracking which blacklist version a device has. |
| `updatedAt` | string | Yes | 1–100 chars. ISO timestamp of when the blacklist was generated. |
| `domains` | string[] | Yes | Max 500,000 entries. Each entry 1–500 chars. Exact match (not wildcard). Lowercased before comparison. |
| `ips` | string[] | Yes | Max 500,000 entries. IPv4 or IPv6 addresses. Exact match. |
| `cidrs` | string[] | Yes | Max 500,000 entries. IPv4 (e.g., `192.0.2.0/24`) or IPv6 (e.g., `2001:db8::/32`) CIDR notation. |

### Hosting Constraints

- Must be reachable via HTTP or HTTPS (HTTPS strongly recommended)
- Max file size: **50 MB**
- Download timeout: **60 seconds**
- The URL **must not** point to localhost, private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x), or IPv6 link-local/unique-local addresses (this is enforced in production builds)

### Blacklist Sources

You can aggregate from public threat intelligence feeds like:
- abuse.ch (Feodo Tracker, URLhaus, ThreatFox)
- Spamhaus DROP/EDROP lists
- Emerging Threats blocklists
- AlienVault OTX
- Your own internal threat intel

---

## Step 2: Implement the Blacklist URL Endpoint (Auto-Fetch on Connect)

When the agent connects and has no blacklist on disk, it automatically requests one:

**Endpoint:** `GET /api/devices/{deviceId}/threat-blacklist-url`

**Response (blacklist available):**
```json
{ "url": "https://your-server.com/api/blacklists/latest.json" }
```

**Response (no blacklist configured):** Return `404` — the agent will silently wait for an `update-threat-blacklist` command instead.

This means new devices get a blacklist immediately on first connect without needing a manual push. The agent only calls this endpoint once per connection if no blacklist exists locally.

---

## Step 3: Push Updates via Command

Broadcast on the device's Reverb channel (`private-device.{deviceId}`, event `DeviceCommand`):

```json
{
  "type": "update-threat-blacklist",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "url": "https://your-server.com/api/blacklists/latest.json"
}
```

### Response (via POST to `/api/devices/{deviceId}/command-result`)

**Success:**
```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "success": true,
  "data": {
    "domains": 1500,
    "ips": 25000,
    "cidrs": 800
  },
  "error": null
}
```

**Failure examples:**
```json
{ "requestId": "...", "success": false, "data": null, "error": "Download failed: HTTP 404" }
{ "requestId": "...", "success": false, "data": null, "error": "Blacklist too large (exceeds 50 MB)" }
{ "requestId": "...", "success": false, "data": null, "error": "Invalid blacklist format: validation failed" }
{ "requestId": "...", "success": false, "data": null, "error": "Private/loopback URLs not allowed" }
```

### Execution Characteristics

- **Mutating command** — cannot run in parallel with other mutating commands
- **Timeout:** 5 minutes (standard command timeout)
- **Rate limited:** 500ms minimum between mutating commands
- After success, the threat monitor immediately reloads and starts scanning with the new blacklist

---

## Step 4: Implement the Threat Alert Endpoint (Immediate Alerts)

**This is the most important endpoint for real-time security.** The agent POSTs here the moment new threats are detected — within 15 seconds for connection matches, within 60 seconds for DNS matches.

**Endpoint:** `POST /api/devices/{deviceId}/threat-alert`

```json
{
  "timestamp": 1710324600000,
  "snapshot": {
    "flaggedConnections": [
      {
        "remoteAddress": "198.51.100.1",
        "remotePort": 443,
        "pid": 5824,
        "matchedRule": "198.51.100.1",
        "matchType": "ip",
        "detectedAt": "2026-03-13T10:30:00.000Z"
      }
    ],
    "flaggedDns": [
      {
        "domain": "malware-c2.example.com",
        "resolvedAddress": "198.51.100.1",
        "matchedRule": "malware-c2.example.com",
        "detectedAt": "2026-03-13T10:31:00.000Z"
      }
    ],
    "blacklistVersion": "2026-03-13-001",
    "lastConnectionScanAt": "2026-03-13T10:31:15.000Z",
    "lastDnsScanAt": "2026-03-13T10:31:00.000Z"
  }
}
```

**Implementation notes:**
- Return `200 OK` (any 2xx) to acknowledge receipt — the agent does not retry on failure
- If this endpoint doesn't exist yet, return `404` — the agent logs the failure but continues operating; threats will still arrive via telemetry
- Each POST contains only **newly-detected** items since the last alert (not the full accumulated snapshot)
- Use this to trigger immediate SOC alerts, Slack notifications, PagerDuty, etc.

**Rate limiting (agent-side):**
- **60-second cooldown** between alert POSTs — if new threats are detected during the cooldown, they are batched and sent when the cooldown expires
- **30 alerts per hour** hard cap — after this limit, further alerts are suppressed until the hour resets
- Each unique connection (`remoteAddress:remotePort`) or domain is only alerted **once** until the blacklist is reloaded or the agent reconnects
- Maximum **500 flagged connections** and **500 flagged DNS entries** can accumulate at any time
- Worst case: **30 POSTs/hour** per device, each containing only incremental new detections

---

## Step 5: Poll with `get-threat-status` (On-Demand)

For situations where you want to check a specific device's threat state without waiting for telemetry:

```json
{ "type": "get-threat-status", "requestId": "uuid" }
```

**Response:**
```json
{
  "requestId": "uuid",
  "success": true,
  "data": {
    "active": true,
    "flaggedConnections": [ ... ],
    "flaggedDns": [ ... ],
    "blacklistVersion": "2026-03-13-001",
    "lastConnectionScanAt": "2026-03-13T10:31:15Z",
    "lastDnsScanAt": "2026-03-13T10:31:00Z"
  }
}
```

If no blacklist has been loaded: `"active": false, "reason": "No blacklist loaded"`.

This command is **parallel-safe** (read-only) and can be polled as frequently as needed without blocking other commands. Use cases:
- Dashboard real-time refresh
- Post-incident investigation
- Verifying a device is actually scanning after a blacklist update

---

## Step 6: Telemetry (Periodic Backup)

Flagged connections also appear in the existing telemetry POST (`/api/devices/{deviceId}/telemetry`) under a new optional `threatSnapshot` field. This field is **only included when there are flagged items** — if no threats are detected, it's omitted entirely.

### Telemetry Payload (with threats)

```json
{
  "cpu": 12.5,
  "memoryPercent": 45.2,
  "memoryUsedBytes": 8589934592,
  "memoryTotalBytes": 17179869184,
  "diskReadBps": 1048576,
  "diskWriteBps": 524288,
  "networkRxBps": 102400,
  "networkTxBps": 51200,
  "uptime": 86400,
  "disks": [],
  "threatSnapshot": {
    "flaggedConnections": [
      {
        "remoteAddress": "198.51.100.1",
        "remotePort": 443,
        "pid": 5824,
        "matchedRule": "198.51.100.1",
        "matchType": "ip",
        "detectedAt": "2026-03-13T10:30:00.000Z"
      },
      {
        "remoteAddress": "203.0.113.50",
        "remotePort": 8080,
        "pid": 3192,
        "matchedRule": "203.0.113.0/24",
        "matchType": "cidr",
        "detectedAt": "2026-03-13T10:30:15.000Z"
      }
    ],
    "flaggedDns": [
      {
        "domain": "malware-c2.example.com",
        "resolvedAddress": "198.51.100.1",
        "matchedRule": "malware-c2.example.com",
        "detectedAt": "2026-03-13T10:31:00.000Z"
      }
    ],
    "blacklistVersion": "2026-03-13-001",
    "lastConnectionScanAt": "2026-03-13T10:31:15.000Z",
    "lastDnsScanAt": "2026-03-13T10:31:00.000Z"
  }
}
```

### Field Reference

**`threatSnapshot`** (only present when threats detected):

| Field | Type | Description |
|-------|------|-------------|
| `flaggedConnections` | array | Active TCP connections matching blacklisted IPs/CIDRs |
| `flaggedDns` | array | DNS cache entries matching blacklisted domains or IPs |
| `blacklistVersion` | string | Version string from the loaded blacklist |
| `lastConnectionScanAt` | string | ISO timestamp of last connection scan |
| `lastDnsScanAt` | string | ISO timestamp of last DNS scan |

**`flaggedConnections[]` items:**

| Field | Type | Description |
|-------|------|-------------|
| `remoteAddress` | string | Remote IP address of the connection |
| `remotePort` | number | Remote port |
| `pid` | number \| null | Process ID (null if unavailable, e.g., on Linux without root) |
| `matchedRule` | string | The blacklist entry that matched (an IP or CIDR string) |
| `matchType` | `"ip"` \| `"cidr"` | Whether it matched a direct IP or a CIDR range |
| `detectedAt` | string | ISO timestamp when the connection was first flagged |

**`flaggedDns[]` items:**

| Field | Type | Description |
|-------|------|-------------|
| `domain` | string | The DNS name that was resolved |
| `resolvedAddress` | string \| null | The IP address it resolved to (if available) |
| `matchedRule` | string | The blacklist entry that matched (domain or IP/CIDR) |
| `detectedAt` | string | ISO timestamp when the entry was first flagged |

### Telemetry Behavior

- Flagged items **accumulate** between telemetry sends (default: every 60 seconds)
- After a successful telemetry POST, accumulated items are **cleared**
- Each unique connection (by `remoteAddress:remotePort`) is only reported **once** until the blacklist is reloaded or the agent reconnects
- Each unique domain is only reported **once** under the same conditions
- Maximum **500 flagged connections** and **500 flagged DNS entries** accumulated at any time

---

## Step 7: Suggested Cloud Implementation

### Recommended Workflow

1. **On device link/connect**: Send `update-threat-blacklist` with your latest blacklist URL
2. **On blacklist update**: Broadcast `update-threat-blacklist` to all connected devices
3. **Implement `POST /api/devices/{deviceId}/threat-alert`**: This is the real-time channel — fires within seconds of detection. Store events and trigger alerts here.
4. **On telemetry receive**: Check for `threatSnapshot` field as a backup/catch-all
5. **Use `get-threat-status`**: For on-demand dashboard polling or post-incident investigation

### Database Schema

```sql
-- Store raw threat events
CREATE TABLE device_threat_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    device_id VARCHAR(36) NOT NULL,
    event_type ENUM('connection', 'dns') NOT NULL,
    remote_address VARCHAR(45),       -- IPv4 or IPv6
    remote_port INT,
    pid INT,
    domain VARCHAR(255),              -- for DNS events
    resolved_address VARCHAR(45),     -- for DNS events
    matched_rule VARCHAR(500) NOT NULL,
    match_type ENUM('ip', 'cidr', 'domain') NOT NULL,
    blacklist_version VARCHAR(100),
    detected_at TIMESTAMP NOT NULL,
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_device_detected (device_id, detected_at),
    INDEX idx_matched_rule (matched_rule)
);

-- Track blacklist versions per device
CREATE TABLE device_blacklist_status (
    device_id VARCHAR(36) PRIMARY KEY,
    blacklist_version VARCHAR(100),
    domains_count INT,
    ips_count INT,
    cidrs_count INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Processing Threat Alerts (Primary — Real-Time)

Implement this endpoint for immediate threat notification:

```python
# POST /api/devices/{device_id}/threat-alert
def handle_threat_alert(device_id, payload):
    snapshot = payload['snapshot']

    for conn in snapshot.get('flaggedConnections', []):
        save_threat_event(
            device_id=device_id,
            event_type='connection',
            remote_address=conn['remoteAddress'],
            remote_port=conn['remotePort'],
            pid=conn.get('pid'),
            matched_rule=conn['matchedRule'],
            match_type=conn['matchType'],
            blacklist_version=snapshot.get('blacklistVersion'),
            detected_at=conn['detectedAt'],
        )

    for dns in snapshot.get('flaggedDns', []):
        save_threat_event(
            device_id=device_id,
            event_type='dns',
            domain=dns['domain'],
            resolved_address=dns.get('resolvedAddress'),
            matched_rule=dns['matchedRule'],
            match_type='domain',
            blacklist_version=snapshot.get('blacklistVersion'),
            detected_at=dns['detectedAt'],
        )

    # Fire immediate alert
    trigger_security_alert(device_id, snapshot)
    return Response(status=200)
```

### Processing Telemetry (Secondary — Backup)

The same data also arrives in regular telemetry as a catch-all:

```python
# POST /api/devices/{device_id}/telemetry
def handle_telemetry(device_id, payload):
    # ... existing telemetry processing ...

    if 'threatSnapshot' in payload:
        snapshot = payload['threatSnapshot']
        # Deduplicate against events already received via threat-alert
        # (use detected_at + remoteAddress as dedup key)
        process_threat_snapshot(device_id, snapshot)
```

### Alerting Suggestions

| Severity | Condition | Action |
|----------|-----------|--------|
| Critical | Any `flaggedConnection` to a known C2 IP | Immediate alert, consider auto-quarantine |
| High | DNS resolution of known malware domain | Alert SOC, flag device for investigation |
| Medium | Connection to suspicious CIDR range | Log and aggregate, alert if pattern persists |

---

## Platform Capabilities

| Feature | Windows | Linux | macOS |
|---------|---------|-------|-------|
| TCP connection scanning | `Get-NetTCPConnection` (PowerShell) | `ss -tunap` | `lsof -i` |
| Process ID in results | Always available | Requires root for other users' processes | Always available |
| DNS cache scanning | `Get-DnsClientCache` (PowerShell) | Not available | Not available |
| Scan intervals | Connections: 15s, DNS: 60s | Connections: 15s | Connections: 15s |

**Key limitation:** DNS cache scanning only works on Windows. On Linux and macOS, only active TCP connections are monitored. This means short-lived connections (e.g., ransomware key fetches) that close before the 15s scan interval may be missed on those platforms but caught on Windows via DNS cache.

---

## Settings

The user can disable the threat monitor by setting `cloud.shareThreatMonitor` to `false` in their agent settings. Default is `true` (enabled).

The cloud can update this setting via the existing `settings:set` mechanism if needed, though it's recommended to leave this as a user choice.

---

## Lifecycle

| Event | Threat Monitor Behavior |
|-------|------------------------|
| Agent connects to cloud | Loads blacklist from disk, starts scanning if blacklist exists |
| Agent disconnects | Stops scanning, clears accumulated data |
| Agent reconnects | Reloads blacklist, restarts scanning |
| `update-threat-blacklist` succeeds | Reloads blacklist, clears dedup cache, restarts scanning |
| `shareThreatMonitor` set to false | Monitor does not start on next connection |
| No blacklist on disk | Monitor is idle, logs message, waits for `update-threat-blacklist` |

---

## Quick Start Checklist

- [ ] Create blacklist JSON file with `version`, `updatedAt`, `domains`, `ips`, `cidrs`
- [ ] Host it at an HTTPS URL accessible to agents
- [ ] Create API endpoint to serve the blacklist (or use a static file/CDN)
- [ ] **Implement `POST /api/devices/{deviceId}/threat-alert`** — real-time alerts (highest priority)
- [ ] On device connect: send `update-threat-blacklist` command with the URL
- [ ] In telemetry handler: check for `threatSnapshot` field as backup, deduplicate against threat-alert
- [ ] Set up alerting/notifications for flagged connections (Slack, PagerDuty, email, etc.)
- [ ] Periodically update the blacklist file and re-push to devices
- [ ] Optionally: poll `get-threat-status` for dashboard real-time views
