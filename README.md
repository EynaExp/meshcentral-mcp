# MeshCentral MCP Server

A Model Context Protocol (MCP) server that lets AI assistants control your MeshCentral panel.

## Features

- List, search, and manage devices (nodes)
- List and manage device groups (meshes)
- Run remote commands on devices (CMD, PowerShell, Linux shell, Agent console)
- Power actions (sleep, reset, poweroff, wake-on-LAN)
- Send toast notifications to devices
- Manage users (list, create, delete)
- View events and audit logs
- Device notes management
- Move devices between groups
- Intel AMT device scanning

## Setup

### 1. Install dependencies

```bash
cd meshcentral-mcp
npm install
```

### 2. Configure MeshCentral credentials

Copy `.env.example` to `.env` and fill in your server details:

```bash
cp .env.example .env
```

Or set environment variables directly:

```bash
MESH_SERVER_URL=https://mesh.yourdomain.com
MESH_USERNAME=admin
MESH_PASSWORD=yourpassword
```

### 3. MCP Client Configuration

Add to your MCP client config (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "meshcentral": {
      "command": "node",
      "args": ["E:\\.RED team\\3.TOOLS\\MeshMCP\\meshcentral-mcp\\src\\index.js"],
      "env": {
        "MESH_SERVER_URL": "https://mesh.yourdomain.com",
        "MESH_USERNAME": "admin",
        "MESH_PASSWORD": "yourpassword"
      }
    }
  }
}
```

For **opencode**, add to your `opencode.json`:

```json
{
  "mcpServers": {
    "meshcentral": {
      "command": "node",
      "args": ["E:\\.RED team\\3.TOOLS\\MeshMCP\\meshcentral-mcp\\src\\index.js"],
      "env": {
        "MESH_SERVER_URL": "https://mesh.yourdomain.com",
        "MESH_USERNAME": "admin",
        "MESH_PASSWORD": "yourpassword"
      }
    }
  }
}
```

## Available Tools (58 total)

### Inventory & Monitoring
| Tool | Description |
|------|-------------|
| `mesh_server_info` | Get server info and stats |
| `mesh_list_devices` | List all devices, optionally by group |
| `mesh_get_device` | Get device details |
| `mesh_list_groups` | List device groups |
| `mesh_list_users` | List users |
| `mesh_list_user_groups` | List user groups |
| `mesh_get_events` | Get audit events |
| `mesh_get_notes` / `mesh_set_notes` | Device notes |
| `mesh_get_lastconnects` | Last connection times for all devices |
| `mesh_get_power_timeline` | Device power state history |
| `mesh_get_sysinfo` | Full hardware info (CPU, RAM, disks, BIOS, Defender) |
| `mesh_get_network_info` | Network interfaces (MACs, IPs, DNS, WiFi) |
| `mesh_get_clipboard` / `mesh_set_clipboard` | Remote clipboard access |

### File Operations (remote device filesystem, via secure tunnels)
| Tool | Description |
|------|-------------|
| `mesh_file_list` | List a directory on a remote device |
| `mesh_file_read` | Read file content (text or base64) |
| `mesh_file_download` | Download remote file to local disk |
| `mesh_file_write` | Write text/base64 content to remote file |
| `mesh_file_upload` | Upload local file to remote device |
| `mesh_file_delete` | Delete files/folders (recursive optional) |
| `mesh_file_mkdir` | Create directory |
| `mesh_file_rename` | Rename/move file or folder |
| `mesh_file_copy` / `mesh_file_move` | Copy/move between directories |
| `mesh_file_find` | Search files by filter |

### Remote Execution & Control
| Tool | Description |
|------|-------------|
| `mesh_run_command` | Shell commands: CMD (1), PowerShell (2), Linux (3), agent console (4) |
| `mesh_agent_console` | Raw agent console (JS) access |
| `mesh_list_processes` / `mesh_kill_process` | Process management |
| `mesh_list_software` | Installed software |
| `mesh_get_device_info` | Agent-reported system summary |
| `mesh_power_action` | Sleep, reset, poweroff, flash, vibrate |
| `mesh_wake_devices` | Wake-on-LAN |
| `mesh_send_toast` | Device notifications |

### Device & Group Management
| Tool | Description |
|------|-------------|
| `mesh_edit_device` | Edit device name, host, tags, ports, consent |
| `mesh_remove_device` | Remove a device |
| `mesh_change_device_group` | Move device between groups |
| `mesh_create_group` / `mesh_delete_group` / `mesh_edit_group` | Device group management |
| `mesh_add_user_to_group` / `mesh_remove_user_from_group` | Group permissions |
| `mesh_add_device_user` | Per-device user permissions |
| `mesh_create_user` / `mesh_delete_user` | User accounts |
| `mesh_create_user_group` / `mesh_delete_user_group` | User group management |

### Agent Management
| Tool | Description |
|------|-------------|
| `mesh_uninstall_agent` | Uninstall agent from device |
| `mesh_create_invite_link` | Agent installation invite URLs |
| `mesh_distribute_core` | Push agent cores (default/recovery/tiny/clear) |
| `mesh_update_agents` | Request agent update |
| `mesh_scan_amt` | Intel AMT network scan |

### Server Administration
| Tool | Description |
|------|-------------|
| `mesh_server_console` | Run server console commands (e.g. "help", "dbstats") |
| `mesh_server_stats` / `mesh_traffic_stats` | Server statistics |
| `mesh_server_errors` | Server error log |
| `mesh_server_version` | Version info |

## Security Notes

- Store credentials in environment variables, never in code
- Use `MESH_INSECURE_TLS=true` only for self-signed certificates in dev/lab environments
- Consider using API tokens (`MESH_TOKEN`) instead of username/password for production use
- The MCP server runs as your user with your MeshCentral permissions
