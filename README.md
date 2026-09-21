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
- Login token authentication (avoids storing real passwords)
- Local file jail (prevents agent from reading .env or escaping designated directory)
- Confirmation tokens for destructive operations
- Connection health check (ping/pong)
- Output sanitization (ANSI stripping, truncation, prompt injection prevention)

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

#### Login tokens (preferred over a password)

Create a login token in the MeshCentral web UI under **My Account → Login tokens**. MeshCentral returns a **pair**: a token username (always prefixed `~t:`) and a token password. Both are required — a token password on its own cannot authenticate.

```
MESH_TOKEN_USER=~t:xxxxxxxxxxxxxxxx
MESH_TOKEN_PASS=xxxxxxxxxxxxxxxxxxxx
```

Or supply both in one variable, comma-separated:

```
MESH_TOKEN=~t:xxxxxxxxxxxxxxxx,xxxxxxxxxxxxxxxxxxxx
```

Tokens can be given an expiry and revoked without changing the account password, so they are the right credential for a service account.

#### Username/password fallback

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
      "args": ["path/to/meshcentral-mcp/src/index.js"],
      "env": {
        "MESH_SERVER_URL": "https://mesh.yourdomain.com",
        "MESH_TOKEN_USER": "~t:xxxxxxxxxxxxxxxx",
        "MESH_TOKEN_PASS": "xxxxxxxxxxxxxxxxxxxx"
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
      "args": ["path/to/meshcentral-mcp/src/index.js"],
      "env": {
        "MESH_SERVER_URL": "https://mesh.yourdomain.com",
        "MESH_TOKEN_USER": "~t:xxxxxxxxxxxxxxxx",
        "MESH_TOKEN_PASS": "xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Available Tools (58 total)

### Inventory & Monitoring
| Tool | Description |
|------|-------------|
| `mesh_server_info` | Get server info and stats (cached from connect) |
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
| `mesh_file_download` | Download remote file to local disk (confined to local file root) |
| `mesh_file_write` | Write text/base64 content to remote file |
| `mesh_file_upload` | Upload local file to remote device (confined to local file root) |
| `mesh_file_delete` | Delete files/folders — requires confirmation token |
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
| `mesh_power_action` | Sleep, reset, poweroff, flash, vibrate (requires confirmation) |
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
| `mesh_uninstall_agent` | Uninstall agent from device (requires confirmation) |
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
- **Use login tokens** (`MESH_TOKEN_USER` / `MESH_TOKEN_PASS`) rather than an account password — set an expiry on them
- **Local file access** is confined to `MESH_LOCAL_FILE_ROOT` (default `./mcp-files`); the agent cannot read `.env` or escape the directory. Set `MESH_LOCAL_FILE_ROOT=*` to disable (not recommended)
- **Confirmation tokens** are required for destructive operations (`mesh_power_action`, `mesh_file_delete`, `mesh_uninstall_agent`) — the tool returns a token on first call that must be re-submitted to proceed
- **Output sanitization** strips ANSI escapes and control characters from all device-sourced output, truncated at 100KB to prevent prompt injection
- **Connection health check** sends periodic pings to detect dead sockets within 30 seconds
- **Serverinfo is cached** from the connect handshake — `mesh_server_info` returns instantly without a second request
- The MCP server acts with the full permissions of the account you give it — use a dedicated, non-admin service account scoped to the device groups you need

## What's New

### Login Token Authentication
Instead of storing your real MeshCentral password, use **login tokens**. Create one in the web UI under **My Account → Login tokens**. Tokens are a user/password pair that can be expired and revoked without changing your account password.

```
MESH_TOKEN_USER=~t:xxxxxxxxxxxxxxxx
MESH_TOKEN_PASS=xxxxxxxxxxxxxxxxxxxx
```

Or combined: `MESH_TOKEN=~t:xxxxxxxxxxxxxxxx,xxxxxxxxxxxxxxxxxxxx`

### Local File Jail (`MESH_LOCAL_FILE_ROOT`)
`mesh_file_download` and `mesh_file_upload` are now confined to a local directory (`./mcp-files` by default). The agent **cannot** read your `.env`, SSH keys, or escape the directory via `..` or symlinks. Set `MESH_LOCAL_FILE_ROOT=*` to disable (not recommended).

### Confirmation Tokens for Destructive Tools
Tools that can cause irreversible damage now require a **two-step confirmation**:
- `mesh_power_action` (sleep/reset/poweroff)
- `mesh_file_delete` (delete files/folders)
- `mesh_uninstall_agent` (remove agent from device)

On first call, the tool returns a confirmation token. Re-invoke with `confirm_token: "<token>"` to proceed. Tokens expire after 120 seconds.

### Connection Health Check
A ping/pong is sent every 30 seconds to detect dead sockets early, instead of waiting for the next command to fail.

### Output Sanitization
All device-sourced output is now sanitized:
- ANSI escape sequences stripped
- Control characters removed (except tab/newline/CR)
- Truncated at 100KB to prevent prompt injection from compromised devices

### Serverinfo Fix
`mesh_server_info` now uses cached data from the connect handshake. No more timeout — returns instantly.

### Serverstats Fix
`mesh_server_stats` push subscription cleanup now uses a `finally` block to guarantee the timer is stopped, even on errors.

## Recommendations and future updates

I will be thankful if you suggest any new feature.
