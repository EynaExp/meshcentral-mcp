#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MeshCentralClient } from './mesh-client.js';
import { localFileRoot, resolveLocalPath } from './local-path.js';
import { toolDefinitions } from './tools.js';

const MESH_SERVER = process.env.MESH_SERVER_URL || process.env.MESH_SERVER || '';
const MESH_USERNAME = process.env.MESH_USERNAME || process.env.MESH_USER || '';
const MESH_PASSWORD = process.env.MESH_PASSWORD || process.env.MESH_PASS || '';
const MESH_DOMAIN = process.env.MESH_DOMAIN || '';
const MESH_INSECURE = process.env.MESH_INSECURE_TLS === 'true' || process.env.MESH_INSECURE === 'true';

function resolveCredentials() {
  const tokenUser = process.env.MESH_TOKEN_USER || '';
  const tokenPass = process.env.MESH_TOKEN_PASS || '';
  const combined = process.env.MESH_TOKEN || process.env.MESH_API_KEY || '';

  if (tokenUser || tokenPass) {
    if (!tokenUser || !tokenPass) {
      return { error: 'MESH_TOKEN_USER and MESH_TOKEN_PASS must both be set - a MeshCentral login token is a user/password pair.' };
    }
    return { username: tokenUser, password: tokenPass, kind: 'login token' };
  }

  if (combined) {
    const sep = combined.indexOf(',');
    if (sep === -1) {
      return {
        error:
          'MESH_TOKEN must hold a full MeshCentral login token as "tokenUser,tokenPass" (the pair returned by ' +
          'createLoginToken), or use the separate MESH_TOKEN_USER and MESH_TOKEN_PASS variables. A token password ' +
          'on its own cannot authenticate.',
      };
    }
    const user = combined.slice(0, sep).trim();
    const pass = combined.slice(sep + 1).trim();
    if (!user || !pass) {
      return { error: 'MESH_TOKEN is malformed - expected "tokenUser,tokenPass".' };
    }
    return { username: user, password: pass, kind: 'login token' };
  }

  if (!MESH_USERNAME) {
    return { error: 'MESH_USERNAME (or a login token via MESH_TOKEN_USER/MESH_TOKEN_PASS) environment variable is required.' };
  }
  if (!MESH_PASSWORD) {
    return { error: 'MESH_PASSWORD (or a login token via MESH_TOKEN_USER/MESH_TOKEN_PASS) environment variable is required.' };
  }
  return { username: MESH_USERNAME, password: MESH_PASSWORD, kind: 'username/password' };
}

if (!MESH_SERVER) {
  console.error('MESH_SERVER_URL environment variable is required.');
  process.exit(1);
}

const credentials = resolveCredentials();
if (credentials.error) {
  console.error(credentials.error);
  process.exit(1);
}

if (credentials.kind === 'login token' && !credentials.username.startsWith('~t:')) {
  console.error(
    `[meshcentral-mcp] WARNING: login token username '${credentials.username}' does not start with '~t:'. ` +
      'MeshCentral generates token usernames with that prefix; authentication will probably fail.'
  );
}

const meshClient = new MeshCentralClient({
  serverUrl: MESH_SERVER,
  username: credentials.username,
  password: credentials.password,
  domain: MESH_DOMAIN,
  rejectUnauthorized: !MESH_INSECURE,
});

const POWER_MAP = { sleep: 3, reset: 4, poweroff: 2, flash: 400, vibrate: 401 };

const server = new McpServer({
  name: 'meshcentral-mcp',
  version: '1.0.0',
});

// ── Helpers ────────────────────────────────────────────────────────────

const MAX_OUTPUT_BYTES = 100_000;

function sanitizeOutput(text) {
  if (typeof text !== 'string') return text;
  let clean = text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (clean.length > MAX_OUTPUT_BYTES) {
    clean = clean.slice(0, MAX_OUTPUT_BYTES) + `\n... [truncated at ${MAX_OUTPUT_BYTES} bytes]`;
  }
  return clean;
}

function wrapResult(text) {
  return { content: [{ type: 'text', text: sanitizeOutput(typeof text === 'string' ? text : JSON.stringify(text, null, 2)) }] };
}

const pendingConfirms = new Map();
let confirmCounter = 0;

function requireConfirm(toolName, description) {
  const token = `confirm_${++confirmCounter}_${Date.now()}`;
  pendingConfirms.set(token, { toolName, created: Date.now() });
  setTimeout(() => pendingConfirms.delete(token), 120_000);
  return {
    content: [{
      type: 'text',
      text: `⚠️ CONFIRMATION REQUIRED\n\nTool: ${toolName}\nAction: ${description}\n\nTo proceed, re-invoke this tool with:\n  confirm_token: "${token}"\n\nToken expires in 120 seconds.`,
    }],
  };
}

function checkConfirm(confirmToken) {
  if (!confirmToken) return null;
  const entry = pendingConfirms.get(confirmToken);
  if (!entry) return { error: 'Invalid or expired confirmation token.' };
  pendingConfirms.delete(confirmToken);
  return null;
}

// ── Helper ──────────────────────────────────────────────────────────────
function nodeId(raw, domain) {
  if (!raw) return raw;
  if (raw.includes('/')) return raw;
  return `node/${domain}/${raw}`;
}

function meshId(raw, domain) {
  if (!raw) return raw;
  if (raw.includes('/')) return raw;
  return `mesh/${domain}/${raw}`;
}

// ── mesh_server_info ────────────────────────────────────────────────────
server.tool(
  'mesh_server_info',
  'Get MeshCentral server information and statistics.',
  {},
  async () => {
    const res = await meshClient.sendCommand({ action: 'serverinfo' }, 10000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_list_groups ────────────────────────────────────────────────────
server.tool(
  'mesh_list_groups',
  'List all device groups (meshes) in MeshCentral.',
  {},
  async () => {
    const res = await meshClient.sendCommand({ action: 'meshes' }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_create_group ───────────────────────────────────────────────────
server.tool(
  'mesh_create_group',
  'Create a new device group in MeshCentral.',
  {
    name: z.string().describe('Name of the new device group'),
    description: z.string().optional().describe('Optional description'),
    type: z.number().optional().describe('Group type: 1=AMT, 2=Agent (default), 3=Local'),
  },
  async ({ name, description, type }) => {
    const cmd = { action: 'createmesh', meshname: name, meshtype: type ?? 2 };
    if (description) cmd.desc = description;
    const res = await meshClient.sendCommand(cmd, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_delete_group ───────────────────────────────────────────────────
server.tool(
  'mesh_delete_group',
  'Delete a device group by ID.',
  {
    meshid: z.string().describe('The mesh/group ID to delete'),
  },
  async ({ meshid }) => {
    const res = await meshClient.sendCommand({ action: 'deletemesh', meshid }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_list_devices ───────────────────────────────────────────────────
server.tool(
  'mesh_list_devices',
  'List all devices, optionally filtered by group name or ID.',
  {
    group_id: z.string().optional().describe('Device group ID or name to filter by'),
  },
  async ({ group_id }) => {
    const cmd = { action: 'nodes' };
    if (group_id) {
      if (group_id.includes('/')) {
        cmd.meshid = group_id;
      } else {
        cmd.meshname = group_id;
      }
    }
    const res = await meshClient.sendCommand(cmd, 20000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_get_device ─────────────────────────────────────────────────────
server.tool(
  'mesh_get_device',
  'Get detailed information about a specific device.',
  {
    node_id: z.string().describe('Device node ID or name'),
  },
  async ({ node_id }) => {
    const cmd = { action: 'nodes', id: node_id };
    const res = await meshClient.sendCommand(cmd, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_edit_device ────────────────────────────────────────────────────
server.tool(
  'mesh_edit_device',
  'Edit a device\'s properties (name, host, tags, consent, ports).',
  {
    node_id: z.string().describe('Device node ID'),
    name: z.string().optional().describe('New display name'),
    host: z.string().optional().describe('New hostname/IP'),
    tags: z.array(z.string()).optional().describe('Tags to set'),
    consent: z.number().optional().describe('Consent flags bitmask'),
    rdpport: z.number().optional().describe('RDP port'),
    sshport: z.number().optional().describe('SSH port'),
  },
  async ({ node_id, ...props }) => {
    const cmd = { action: 'changedevice', nodeid: node_id, ...props };
    if (cmd.tags && typeof cmd.tags === 'object') cmd.tags = JSON.stringify(cmd.tags);
    const res = await meshClient.sendCommand(cmd, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_remove_device ──────────────────────────────────────────────────
server.tool(
  'mesh_remove_device',
  'Remove/delete a device from MeshCentral.',
  {
    node_id: z.string().describe('Device node ID to remove'),
  },
  async ({ node_id }) => {
    const res = await meshClient.sendCommand({ action: 'removedevices', nodeids: [node_id] }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_agent_console ─────────────────────────────────────────────────
server.tool(
  'mesh_agent_console',
  'Send a raw command to the MeshAgent console on a device. Same as the agent console in the MeshCentral web UI. Common commands: "help", "agentsinfo", "coreinfo", "osinfo()", "sysinfo()", "NetInfoEnumeration()", "processes()".',
  {
    node_id: z.string().describe('Device node ID'),
    command: z.string().describe('Agent console command to execute'),
  },
  async ({ node_id, command }) => {
    const cmd = {
      action: 'runcommands',
      nodeids: [node_id],
      cmds: command,
      type: 4,
      reply: true,
    };
    const res = await meshClient.sendCommand(cmd, 30000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_run_command ────────────────────────────────────────────────────
server.tool(
  'mesh_run_command',
  'Run a shell command on a remote device via MeshAgent. Type: 0=auto, 1=CMD, 2=PowerShell, 3=Linux/macOS, 4=Agent console.',
  {
    node_id: z.string().describe('Device node ID'),
    command: z.string().describe('Command to execute'),
    type: z.number().optional().describe('Command type: 0=auto, 1=CMD, 2=PS, 3=Linux, 4=Agent console'),
    reply: z.boolean().optional().describe('Request command output back'),
  },
  async ({ node_id, command, type, reply }) => {
    const cmd = {
      action: 'runcommands',
      nodeids: [node_id],
      cmds: command,
      type: type ?? 0,
      reply: reply ?? true,
    };
    const res = await meshClient.sendCommand(cmd, 30000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_get_device_info ───────────────────────────────────────────────
server.tool(
  'mesh_get_device_info',
  'Get detailed system info from a connected device agent (OS, hardware, network, uptime).',
  {
    node_id: z.string().describe('Device node ID'),
  },
  async ({ node_id }) => {
    const res = await meshClient.sendCommand({
      action: 'runcommands',
      nodeids: [node_id],
      cmds: 'JSON.stringify({coreinfo: core.agent ? "Agent " + core.agent : "Unknown", osinfo: osinfo ? osinfo() : null, sysinfo: typeof sysinfo === "function" ? sysinfo() : null, netinfo: typeof NetInfoEnumeration === "function" ? NetInfoEnumeration() : null})',
      type: 4,
      reply: true,
    }, 30000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_list_processes ────────────────────────────────────────────────
server.tool(
  'mesh_list_processes',
  'List running processes on a remote device.',
  {
    node_id: z.string().describe('Device node ID'),
  },
  async ({ node_id }) => {
    const res = await meshClient.sendCommand({
      action: 'runcommands',
      nodeids: [node_id],
      cmds: 'JSON.stringify(typeof processes === "function" ? processes() : "processes() not available")',
      type: 4,
      reply: true,
    }, 30000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_list_software ─────────────────────────────────────────────────
server.tool(
  'mesh_list_software',
  'List installed software on a remote device.',
  {
    node_id: z.string().describe('Device node ID'),
  },
  async ({ node_id }) => {
    const res = await meshClient.sendCommand({
      action: 'software',
      nodeids: [node_id],
      type: 1,
    }, 30000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_kill_process ──────────────────────────────────────────────────
server.tool(
  'mesh_kill_process',
  'Kill a process on a remote device by PID. Auto-detects OS from the device.',
  {
    node_id: z.string().describe('Device node ID'),
    pid: z.number().describe('Process ID to kill'),
  },
  async ({ node_id, pid }) => {
    const res = await meshClient.sendCommand({
      action: 'runcommands',
      nodeids: [node_id],
      cmds: `taskkill /F /PID ${pid} 2>/dev/null || kill -9 ${pid}`,
      type: 0,
      reply: true,
    }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_power_action ───────────────────────────────────────────────────
server.tool(
  'mesh_power_action',
  'Send a power action to devices: sleep, reset, poweroff, flash, vibrate.',
  {
    node_ids: z.array(z.string()).describe('Array of device node IDs'),
    action: z.enum(['sleep', 'reset', 'poweroff', 'flash', 'vibrate']).describe('Power action'),
  },
  async ({ node_ids, action }) => {
    const actiontype = POWER_MAP[action];
    if (!actiontype) return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    const res = await meshClient.sendCommand({ action: 'poweraction', nodeids: node_ids, actiontype }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_wake_devices ───────────────────────────────────────────────────
server.tool(
  'mesh_wake_devices',
  'Send Wake-on-LAN to wake up devices.',
  {
    node_ids: z.array(z.string()).describe('Array of device node IDs to wake'),
  },
  async ({ node_ids }) => {
    const res = await meshClient.sendCommand({ action: 'wakedevices', nodeids: node_ids }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_send_toast ─────────────────────────────────────────────────────
server.tool(
  'mesh_send_toast',
  'Send a toast notification to devices.',
  {
    node_ids: z.array(z.string()).describe('Array of device node IDs'),
    message: z.string().describe('Notification message'),
  },
  async ({ node_ids, message }) => {
    const res = await meshClient.sendCommand({ action: 'toast', nodeids: node_ids, msg: message }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_list_users ─────────────────────────────────────────────────────
server.tool(
  'mesh_list_users',
  'List all users on the MeshCentral server.',
  {},
  async () => {
    const res = await meshClient.sendCommand({ action: 'users' }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_create_user ────────────────────────────────────────────────────
server.tool(
  'mesh_create_user',
  'Create a new user account on MeshCentral.',
  {
    username: z.string().describe('Username'),
    password: z.string().describe('Password'),
    email: z.string().optional().describe('Email address'),
    realname: z.string().optional().describe('Real name'),
  },
  async ({ username, password, email, realname }) => {
    const cmd = { action: 'adduser', username, pass: password };
    if (email) cmd.email = email;
    if (realname) cmd.realname = realname;
    const res = await meshClient.sendCommand(cmd, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_delete_user ────────────────────────────────────────────────────
server.tool(
  'mesh_delete_user',
  'Delete a user account.',
  {
    userid: z.string().describe('User ID (e.g. "user/domain/username")'),
  },
  async ({ userid }) => {
    const res = await meshClient.sendCommand({ action: 'deleteuser', userid }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_get_events ─────────────────────────────────────────────────────
server.tool(
  'mesh_get_events',
  'Get recent events. Filter by device or user.',
  {
    node_id: z.string().optional().describe('Filter by device node ID'),
    userid: z.string().optional().describe('Filter by user ID'),
    limit: z.number().optional().describe('Max events (default 50)'),
  },
  async ({ node_id, userid, limit }) => {
    const cmd = { action: 'events' };
    if (node_id) cmd.nodeid = node_id;
    if (userid) cmd.userid = userid;
    if (limit) cmd.limit = limit;
    const res = await meshClient.sendCommand(cmd, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_get_notes ──────────────────────────────────────────────────────
server.tool(
  'mesh_get_notes',
  'Get notes/description for a device.',
  {
    node_id: z.string().describe('Device node ID'),
  },
  async ({ node_id }) => {
    const res = await meshClient.sendCommand({ action: 'getNotes', id: node_id }, 10000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_set_notes ──────────────────────────────────────────────────────
server.tool(
  'mesh_set_notes',
  'Set notes/description for a device.',
  {
    node_id: z.string().describe('Device node ID'),
    notes: z.string().describe('Notes text to set'),
  },
  async ({ node_id, notes }) => {
    try {
      // setNotes never replies - fire and forget; verify with mesh_get_notes
      meshClient.sendRaw({ action: 'setNotes', id: node_id, notes });
      return { content: [{ type: 'text', text: 'Notes set (fire-and-forget, verify with mesh_get_notes)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_change_device_group ────────────────────────────────────────────
server.tool(
  'mesh_change_device_group',
  'Move a device to a different device group.',
  {
    node_id: z.string().describe('Device node ID to move'),
    meshid: z.string().describe('Target group/mesh ID'),
  },
  async ({ node_id, meshid }) => {
    const res = await meshClient.sendCommand({
      action: 'changeDeviceMesh',
      nodeids: [node_id],
      meshid,
    }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_scan_amt ───────────────────────────────────────────────────────
server.tool(
  'mesh_scan_amt',
  'Scan a network range for Intel AMT devices.',
  {
    iprange: z.string().describe('IP range (e.g. "192.168.1.0/24")'),
  },
  async ({ iprange }) => {
    const res = await meshClient.sendCommand({ action: 'scanamtdevice', iprange }, 30000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════════════
// FILE OPERATIONS (via meshrelay.ashx p=5 tunnels)
// ════════════════════════════════════════════════════════════════════════

async function withFileTunnel(node_id, fn) {
  const tunnel = await meshClient.openFileTunnel(node_id);
  try {
    return await fn(tunnel);
  } finally {
    tunnel.close();
  }
}

// ── mesh_file_list ─────────────────────────────────────────────────────
server.tool(
  'mesh_file_list',
  'List files and folders on a remote device (uses the same tunnel as the MeshCentral file manager).',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    path: z.string().describe('Directory path (e.g. "C:\\\\" on Windows, "/" on Linux)'),
  },
  async ({ node_id, path: dirPath }) => {
    try {
      const dir = await withFileTunnel(node_id, (t) => t.list(dirPath));
      return { content: [{ type: 'text', text: JSON.stringify(dir, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_read ─────────────────────────────────────────────────────
server.tool(
  'mesh_file_read',
  'Read a file from a remote device and return its content. Binary files are returned as base64. Use mesh_file_download for large files.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    file_path: z.string().describe('Full path of the file to read'),
    max_kb: z.number().optional().describe('Max size to read in KB (default 512, max 2048)'),
  },
  async ({ node_id, file_path, max_kb }) => {
    const maxBytes = Math.min(max_kb ?? 512, 2048) * 1024;
    try {
      const data = await withFileTunnel(node_id, (t) => t.download(file_path));
      if (data.length === 0) {
        return { content: [{ type: 'text', text: '(empty file, 0 bytes)' }] };
      }
      if (data.length > maxBytes) {
        return { content: [{ type: 'text', text: `File is ${data.length} bytes (max ${maxBytes}). Use mesh_file_download to save it locally instead.` }], isError: true };
      }
      // Try UTF-8; if it contains many nulls/non-printables, return base64
      const text = data.toString('utf8');
      const printable = text.split('').filter(c => c.charCodeAt(0) >= 9 && c.charCodeAt(0) !== 65533).length / text.length;
      if (printable > 0.95) {
        return { content: [{ type: 'text', text: text }] };
      }
      return { content: [{ type: 'text', text: `[BINARY FILE, ${data.length} bytes, base64]\n${data.toString('base64')}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_download ─────────────────────────────────────────────────
server.tool(
  'mesh_file_download',
  'Download a file from a remote device to a local path on the machine running this MCP server.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    remote_path: z.string().describe('Full path of the file on the remote device'),
    local_path: z.string().describe('Local destination path'),
  },
  async ({ node_id, remote_path, local_path: localPath }) => {
    try {
      const data = await withFileTunnel(node_id, (t) => t.download(remote_path));
      fs.writeFileSync(localPath, data);
      return { content: [{ type: 'text', text: `Downloaded ${data.length} bytes from ${remote_path} to ${localPath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_write ────────────────────────────────────────────────────
server.tool(
  'mesh_file_write',
  'Write text or base64 content to a file on a remote device.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    file_path: z.string().describe('Full destination path on the remote device'),
    content: z.string().describe('Content to write'),
    encoding: z.enum(['utf8', 'base64']).optional().describe('Content encoding (default utf8)'),
  },
  async ({ node_id, file_path, content, encoding }) => {
    try {
      const data = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
      const dir = path.dirname(file_path).replace(/\\/g, '/');
      const name = path.basename(file_path);
      await withFileTunnel(node_id, (t) => t.upload(dir, name, data));
      return { content: [{ type: 'text', text: `Wrote ${data.length} bytes to ${file_path}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_upload ───────────────────────────────────────────────────
server.tool(
  'mesh_file_upload',
  'Upload a local file to a remote device.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    local_path: z.string().describe('Local file to upload'),
    remote_dir: z.string().describe('Destination directory on the remote device'),
    remote_name: z.string().optional().describe('Destination filename (default: same as local)'),
  },
  async ({ node_id, local_path: localPath, remote_dir: remoteDir, remote_name }) => {
    try {
      const data = fs.readFileSync(localPath);
      const name = remote_name || path.basename(localPath);
      await withFileTunnel(node_id, (t) => t.upload(remoteDir, name, data));
      return { content: [{ type: 'text', text: `Uploaded ${localPath} (${data.length} bytes) to ${remoteDir}${remoteDir.endsWith('/') || remoteDir.endsWith('\\') ? '' : '/'}${name}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_delete ───────────────────────────────────────────────────
server.tool(
  'mesh_file_delete',
  'Delete files or folders on a remote device.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    path: z.string().describe('Parent directory containing the files'),
    names: z.array(z.string()).describe('File/folder names to delete (relative to path)'),
    recursive: z.boolean().optional().describe('Recursive delete for folders (default false)'),
  },
  async ({ node_id, path: dirPath, names, recursive }) => {
    try {
      await withFileTunnel(node_id, (t) => t.delete(dirPath, names, recursive ?? false));
      return { content: [{ type: 'text', text: `Deleted ${JSON.stringify(names)} from ${dirPath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_mkdir ────────────────────────────────────────────────────
server.tool(
  'mesh_file_mkdir',
  'Create a directory on a remote device.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    path: z.string().describe('Full path of the directory to create'),
  },
  async ({ node_id, path: dirPath }) => {
    try {
      await withFileTunnel(node_id, (t) => t.mkdir(dirPath));
      return { content: [{ type: 'text', text: `Created directory ${dirPath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_rename ───────────────────────────────────────────────────
server.tool(
  'mesh_file_rename',
  'Rename (or move within the same directory) a file or folder on a remote device.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    path: z.string().describe('Parent directory'),
    old_name: z.string().describe('Current name'),
    new_name: z.string().describe('New name'),
  },
  async ({ node_id, path: dirPath, old_name, new_name }) => {
    try {
      await withFileTunnel(node_id, (t) => t.rename(dirPath, old_name, new_name));
      return { content: [{ type: 'text', text: `Renamed ${old_name} to ${new_name} in ${dirPath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_copy ─────────────────────────────────────────────────────
server.tool(
  'mesh_file_copy',
  'Copy files between directories on a remote device.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    source_dir: z.string().describe('Source directory'),
    dest_dir: z.string().describe('Destination directory'),
    names: z.array(z.string()).describe('File names to copy (relative to source_dir)'),
  },
  async ({ node_id, source_dir, dest_dir, names }) => {
    try {
      await withFileTunnel(node_id, (t) => t.copy(source_dir, dest_dir, names));
      return { content: [{ type: 'text', text: `Copied ${JSON.stringify(names)} from ${source_dir} to ${dest_dir}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_move ─────────────────────────────────────────────────────
server.tool(
  'mesh_file_move',
  'Move files between directories on a remote device.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    source_dir: z.string().describe('Source directory'),
    dest_dir: z.string().describe('Destination directory'),
    names: z.array(z.string()).describe('File names to move (relative to source_dir)'),
  },
  async ({ node_id, source_dir, dest_dir, names }) => {
    try {
      await withFileTunnel(node_id, (t) => t.move(source_dir, dest_dir, names));
      return { content: [{ type: 'text', text: `Moved ${JSON.stringify(names)} from ${source_dir} to ${dest_dir}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_file_find ─────────────────────────────────────────────────────
server.tool(
  'mesh_file_find',
  'Search for files on a remote device by name filter.',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    path: z.string().describe('Directory to search in'),
    filter: z.string().describe('Filename filter (e.g. "*.log")'),
  },
  async ({ node_id, path: dirPath, filter }) => {
    try {
      const results = await withFileTunnel(node_id, (t) => t.find(dirPath, filter));
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ════════════════════════════════════════════════════════════════════════
// DETAIL GATHERING
// ════════════════════════════════════════════════════════════════════════

// ── mesh_get_sysinfo ───────────────────────────────────────────────────
server.tool(
  'mesh_get_sysinfo',
  'Get full hardware/system info for a device (CPU, RAM, disks/volumes, BIOS, OS details, Defender status). Data is collected by the agent and stored server-side.',
  {
    node_id: z.string().describe('Device node ID'),
  },
  async ({ node_id }) => {
    const res = await meshClient.sendCommand({ action: 'getsysinfo', nodeid: node_id }, 20000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_get_network_info ──────────────────────────────────────────────
server.tool(
  'mesh_get_network_info',
  'Get network interface information for a device (MACs, IPs, gateways, DNS, WiFi).',
  {
    node_id: z.string().describe('Device node ID'),
  },
  async ({ node_id }) => {
    const res = await meshClient.sendCommand({ action: 'getnetworkinfo', nodeid: node_id }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_get_power_timeline ────────────────────────────────────────────
server.tool(
  'mesh_get_power_timeline',
  'Get the power state history for a device (on/off/sleep timeline).',
  {
    node_id: z.string().describe('Device node ID'),
  },
  async ({ node_id }) => {
    const res = await meshClient.sendCommand({ action: 'powertimeline', nodeid: node_id }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_get_lastconnects ──────────────────────────────────────────────
server.tool(
  'mesh_get_lastconnects',
  'Get the last connection times for all devices the user can see.',
  {},
  async () => {
    const res = await meshClient.sendCommand({ action: 'lastconnects' }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_get_clipboard ─────────────────────────────────────────────────
server.tool(
  'mesh_get_clipboard',
  'Read the clipboard content of a remote device (requires agent online and a clipboard module on the agent).',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
  },
  async ({ node_id }) => {
    try {
      // Route via msg/getclip (adds sessionid so the response comes back to us); tag:3 suppresses audit logging
      meshClient.sendRaw({ action: 'msg', type: 'getclip', nodeid: node_id, tag: 3 });
      const res = await meshClient.waitForMessage(
        (msg) => msg.action === 'msg' && msg.type === 'getclip' && msg.data !== undefined,
        15000
      );
      return { content: [{ type: 'text', text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message} (agent may be unable to read the clipboard, e.g. empty clipboard or missing clipboard module)` }], isError: true };
    }
  }
);

// ── mesh_set_clipboard ─────────────────────────────────────────────────
server.tool(
  'mesh_set_clipboard',
  'Set the clipboard content on a remote device (requires agent online).',
  {
    node_id: z.string().describe('Device node ID (must be online)'),
    data: z.string().describe('Text to place on the clipboard'),
  },
  async ({ node_id, data }) => {
    try {
      meshClient.sendRaw({ action: 'msg', type: 'setclip', nodeid: node_id, data });
      const res = await meshClient.waitForMessage(
        (msg) => msg.action === 'msg' && msg.type === 'setclip' && msg.success !== undefined,
        15000
      );
      return { content: [{ type: 'text', text: res.success ? 'Clipboard set successfully' : 'Setclip failed on device' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ════════════════════════════════════════════════════════════════════════
// USERS & PERMISSIONS
// ════════════════════════════════════════════════════════════════════════

// ── mesh_add_user_to_group ─────────────────────────────────────────────
server.tool(
  'mesh_add_user_to_group',
  'Grant a user access to a device group with specific rights. Rights bitmask: 1=editMesh, 2=manageUsers, 4=manageComputers, 8=remoteControl, 16=agentConsole, 32=remoteCommand, 64=resetOff, 128=remoteViewOnly, 256=notes, 512=desktop, 1024=terminal, 2048=files, 4096=amt, 8192=httpUrl, 16384=share, 32768=wakeDevice, 65536=details.',
  {
    user_id: z.string().describe('User ID or username'),
    mesh_id: z.string().describe('Device group ID'),
    rights: z.number().describe('Rights bitmask (4294967295 = full admin)'),
  },
  async ({ user_id, mesh_id, rights }) => {
    const res = await meshClient.sendCommand({
      action: 'addmeshuser',
      meshid: mesh_id,
      userids: [user_id],
      meshadmin: rights,
    }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_remove_user_from_group ────────────────────────────────────────
server.tool(
  'mesh_remove_user_from_group',
  'Remove a user\'s access to a device group.',
  {
    user_id: z.string().describe('User ID or username'),
    mesh_id: z.string().describe('Device group ID'),
  },
  async ({ user_id, mesh_id }) => {
    const res = await meshClient.sendCommand({
      action: 'addmeshuser',
      meshid: mesh_id,
      userids: [user_id],
      meshadmin: 0,
      remove: true,
    }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_add_device_user ───────────────────────────────────────────────
server.tool(
  'mesh_add_device_user',
  'Grant a user direct access to a single device (device-level link).',
  {
    node_id: z.string().describe('Device node ID'),
    user_id: z.string().describe('User ID or username'),
    rights: z.number().describe('Rights bitmask (bits 0-2 not allowed for device links)'),
    remove: z.boolean().optional().describe('Set true to remove the link'),
  },
  async ({ node_id, user_id, rights, remove }) => {
    const res = await meshClient.sendCommand({
      action: 'adddeviceuser',
      nodeid: node_id,
      userids: [user_id],
      rights,
      ...(remove ? { remove: true } : {}),
    }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_edit_group ────────────────────────────────────────────────────
server.tool(
  'mesh_edit_group',
  'Edit a device group name or description.',
  {
    mesh_id: z.string().describe('Device group ID'),
    name: z.string().optional().describe('New group name'),
    description: z.string().optional().describe('New description'),
  },
  async ({ mesh_id, name, description }) => {
    const cmd = { action: 'editmesh', meshid: mesh_id };
    if (name) cmd.meshname = name;
    if (description !== undefined) cmd.desc = description;
    const res = await meshClient.sendCommand(cmd, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_create_user_group ─────────────────────────────────────────────
server.tool(
  'mesh_create_user_group',
  'Create a user group (for batch-managing permissions).',
  {
    name: z.string().describe('User group name'),
    description: z.string().optional().describe('Description'),
  },
  async ({ name, description }) => {
    const cmd = { action: 'createusergroup', name };
    if (description) cmd.desc = description;
    const res = await meshClient.sendCommand(cmd, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_delete_user_group ─────────────────────────────────────────────
server.tool(
  'mesh_delete_user_group',
  'Delete a user group.',
  {
    ugrp_id: z.string().describe('User group ID (ugrp/...)'),
  },
  async ({ ugrp_id }) => {
    const res = await meshClient.sendCommand({ action: 'deleteusergroup', ugrpid: ugrp_id }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_list_user_groups ──────────────────────────────────────────────
server.tool(
  'mesh_list_user_groups',
  'List all user groups.',
  {},
  async () => {
    const res = await meshClient.sendCommand({ action: 'usergroups' }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════════════
// AGENT MANAGEMENT
// ════════════════════════════════════════════════════════════════════════

// ── mesh_uninstall_agent ───────────────────────────────────────────────
server.tool(
  'mesh_uninstall_agent',
  'Uninstall the MeshCentral agent from a device.',
  {
    node_id: z.string().describe('Device node ID'),
  },
  async ({ node_id }) => {
    const res = await meshClient.sendCommand({ action: 'uninstallagent', nodeid: node_id }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_create_invite_link ────────────────────────────────────────────
server.tool(
  'mesh_create_invite_link',
  'Create an agent installation invite link for a device group.',
  {
    mesh_id: z.string().describe('Device group ID'),
    expire_hours: z.number().optional().describe('Link expiry in hours (default 8)'),
    flags: z.number().optional().describe('Invite flags (0=installation link)'),
  },
  async ({ mesh_id, expire_hours, flags }) => {
    const res = await meshClient.sendCommand({
      action: 'createInviteLink',
      meshid: mesh_id,
      expire: expire_hours ?? 8,
      flags: flags ?? 0,
    }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_distribute_core ───────────────────────────────────────────────
server.tool(
  'mesh_distribute_core',
  'Push a new agent core to devices (default=recover core, clear, recovery, tiny).',
  {
    node_ids: z.array(z.string()).describe('Device node IDs'),
    type: z.enum(['default', 'clear', 'recovery', 'tiny']).describe('Core type'),
  },
  async ({ node_ids, type }) => {
    try { meshClient.sendRaw({ action: 'uploadagentcore', nodeids: node_ids, type }); } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
    return { content: [{ type: 'text', text: `Core '${type}' distribution requested for ${node_ids.length} device(s)` }] };
  }
);

// ── mesh_update_agents ─────────────────────────────────────────────────
server.tool(
  'mesh_update_agents',
  'Request agents on a device to update to the latest version.',
  {
    node_id: z.string().describe('Device node ID'),
  },
  async ({ node_id }) => {
    try { meshClient.sendRaw({ action: 'updateAgents', nodeids: [node_id] }); } catch (err) {
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
    return { content: [{ type: 'text', text: 'Agent update requested' }] };
  }
);

// ════════════════════════════════════════════════════════════════════════
// SERVER ADMINISTRATION
// ════════════════════════════════════════════════════════════════════════

// ── mesh_server_stats ──────────────────────────────────────────────────
server.tool(
  'mesh_server_stats',
  'Get MeshCentral server statistics (connections, memory, traffic).',
  {},
  async () => {
    try {
      // serverstats is a push subscription: request a 1s interval, take the first push, then stop
      meshClient.sendRaw({ action: 'serverstats', interval: 1000 });
      const res = await meshClient.waitForMessage((msg) => msg.action === 'serverstats' && msg.totalmem !== undefined, 15000);
      try { meshClient.sendRaw({ action: 'serverstats' }); } catch {} // stop the timer
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      try { meshClient.sendRaw({ action: 'serverstats' }); } catch {} // stop the timer on failure too
      return { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true };
    }
  }
);

// ── mesh_server_errors ─────────────────────────────────────────────────
server.tool(
  'mesh_server_errors',
  'Get the MeshCentral server error log.',
  {},
  async () => {
    const res = await meshClient.sendCommand({ action: 'servererrors' }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_server_version ────────────────────────────────────────────────
server.tool(
  'mesh_server_version',
  'Get the MeshCentral server version info.',
  {},
  async () => {
    const res = await meshClient.sendCommand({ action: 'serverversion' }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_server_console ────────────────────────────────────────────────
server.tool(
  'mesh_server_console',
  'Run a server console command on MeshCentral (like the "My Server" console in the web UI). Examples: "heap", "dispatchtable", "agentstats", "dbstats", "certexpire", "args", "usersessions".',
  {
    command: z.string().describe('Server console command to run'),
  },
  async ({ command }) => {
    const res = await meshClient.sendCommand({ action: 'serverconsole', value: command }, 20000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── mesh_traffic_stats ─────────────────────────────────────────────────
server.tool(
  'mesh_traffic_stats',
  'Get server traffic statistics.',
  {},
  async () => {
    const res = await meshClient.sendCommand({ action: 'trafficstats' }, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ── Start ───────────────────────────────────────────────────────────────
async function main() {
  try {
    await meshClient.connect();
    console.error('[meshcentral-mcp] Connected to MeshCentral');
  } catch (err) {
    console.error(`[meshcentral-mcp] Failed to connect: ${err.message}`);
    console.error('[meshcentral-mcp] Will retry on first command...');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`[meshcentral-mcp] Fatal: ${err.message}`);
  process.exit(1);
});
