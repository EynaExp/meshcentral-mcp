#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MeshCentralClient } from './mesh-client.js';
import { toolDefinitions } from './tools.js';

const MESH_SERVER = process.env.MESH_SERVER_URL || process.env.MESH_SERVER || '';
const MESH_USERNAME = process.env.MESH_USERNAME || process.env.MESH_USER || '';
const MESH_PASSWORD = process.env.MESH_PASSWORD || process.env.MESH_PASS || '';
const MESH_TOKEN = process.env.MESH_TOKEN || process.env.MESH_API_KEY || '';
const MESH_DOMAIN = process.env.MESH_DOMAIN || '';
const MESH_INSECURE = process.env.MESH_INSECURE_TLS === 'true' || process.env.MESH_INSECURE === 'true';

if (!MESH_SERVER) {
  console.error('MESH_SERVER_URL environment variable is required.');
  process.exit(1);
}

if (!MESH_USERNAME && !MESH_TOKEN) {
  console.error('MESH_USERNAME (or MESH_TOKEN) environment variable is required.');
  process.exit(1);
}

if (!MESH_PASSWORD && !MESH_TOKEN) {
  console.error('MESH_PASSWORD (or MESH_TOKEN) environment variable is required.');
  process.exit(1);
}

const meshClient = new MeshCentralClient({
  serverUrl: MESH_SERVER,
  username: MESH_USERNAME || 'token',
  password: MESH_TOKEN || MESH_PASSWORD,
  domain: MESH_DOMAIN,
  rejectUnauthorized: !MESH_INSECURE,
});

const POWER_MAP = { sleep: 3, reset: 4, poweroff: 2, flash: 400, vibrate: 401 };

const server = new McpServer({
  name: 'meshcentral-mcp',
  version: '1.0.0',
});

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

// ── mesh_file_list ─────────────────────────────────────────────────────
server.tool(
  'mesh_file_list',
  'List files and folders on a remote device (like the file manager in MeshCentral web UI).',
  {
    node_id: z.string().describe('Device node ID'),
    path: z.string().optional().describe('Directory path to list (e.g. "C:\\\\" on Windows, "/" on Linux)'),
  },
  async ({ node_id, path }) => {
    const listPath = path || '';
    const res = await meshClient.sendCommand({
      action: 'runcommands',
      nodeids: [node_id],
      cmds: `JSON.stringify(typeof fs === "object" ? {entries: fs.readdirSync("${listPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}") } : "fs not available")`,
      type: 4,
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
    const res = await meshClient.sendCommand({ action: 'getNotes', nodeid: node_id }, 10000);
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
    const res = await meshClient.sendCommand({ action: 'setNotes', nodeid: node_id, notes }, 10000);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
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
