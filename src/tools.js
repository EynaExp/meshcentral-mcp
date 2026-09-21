export const toolDefinitions = [
  {
    name: 'mesh_list_devices',
    description: 'List all devices (nodes) in MeshCentral, optionally filtered by device group. Returns device info including name, OS, connectivity status, and agent version.',
    inputSchema: {
      type: 'object',
      properties: {
        group_id: {
          type: 'string',
          description: 'Optional device group (mesh) ID or name to filter by. Omit to list all devices.',
        },
      },
    },
  },
  {
    name: 'mesh_get_device',
    description: 'Get detailed information about a specific device by its node ID or name.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID (e.g. "node/domain/hash") or device name to look up.',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'mesh_list_groups',
    description: 'List all device groups (meshes) in MeshCentral. Returns group names, types, and IDs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mesh_create_group',
    description: 'Create a new device group in MeshCentral.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the new device group.',
        },
        description: {
          type: 'string',
          description: 'Optional description for the group.',
        },
        type: {
          type: 'number',
          description: 'Group type: 1 = Intel AMT only, 2 = Agent, 3 = Local devices. Default: 2.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'mesh_delete_group',
    description: 'Delete a device group by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        meshid: {
          type: 'string',
          description: 'The mesh/group ID to delete.',
        },
      },
      required: ['meshid'],
    },
  },
  {
    name: 'mesh_edit_device',
    description: 'Edit a device\'s properties such as name, host, consent, ports, or tags.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID.',
        },
        name: {
          type: 'string',
          description: 'New display name for the device.',
        },
        host: {
          type: 'string',
          description: 'New hostname/IP for the device.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to set on the device.',
        },
        consent: {
          type: 'number',
          description: 'Consent flags (bitmask).',
        },
        rdpport: {
          type: 'number',
          description: 'RDP port number.',
        },
        sshport: {
          type: 'number',
          description: 'SSH port number.',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'mesh_remove_device',
    description: 'Remove/delete a device from MeshCentral.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID to remove.',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'mesh_agent_console',
    description: 'Send a raw command to the MeshAgent console on a device. This is the same as the agent console in the MeshCentral web UI. Use this for advanced agent operations like running JS code on the agent, querying agent internals, or controlling agent modules. Common commands: "help", "agentsinfo", "coreinfo", "osinfo()", "sysinfo()", "NetInfoEnumeration()", "processes()", "WMICapability()".',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID.',
        },
        command: {
          type: 'string',
          description: 'The agent console command to execute.',
        },
      },
      required: ['node_id', 'command'],
    },
  },
  {
    name: 'mesh_run_command',
    description: 'Run a shell command on a remote device via the MeshAgent. The device must be online and have an active agent connection.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID to run the command on.',
        },
        command: {
          type: 'string',
          description: 'The command string to execute.',
        },
        type: {
          type: 'number',
          description: 'Command type: 0 = auto-detect, 1 = Windows CMD, 2 = Windows PowerShell, 3 = Linux/macOS shell, 4 = Agent console. Default: 0.',
        },
        reply: {
          type: 'boolean',
          description: 'If true, request the agent to send back the command output. Default: true.',
        },
      },
      required: ['node_id', 'command'],
    },
  },
  {
    name: 'mesh_get_device_info',
    description: 'Get detailed system information from a connected device agent. Returns OS info, hardware specs, network interfaces, uptime, and agent version. Uses the agent console to query the device.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID.',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'mesh_list_processes',
    description: 'List running processes on a remote device via the MeshAgent. Returns process name, PID, CPU usage, and memory.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID.',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'mesh_list_software',
    description: 'List installed software on a remote device via the MeshAgent.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID.',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'mesh_kill_process',
    description: 'Kill a process on a remote device by PID.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID.',
        },
        pid: {
          type: 'number',
          description: 'Process ID to kill.',
        },
      },
      required: ['node_id', 'pid'],
    },
  },
  {
    name: 'mesh_file_list',
    description: 'List files and folders on a remote device via the MeshAgent. Works like browsing the file manager in the MeshCentral web UI.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID.',
        },
        path: {
          type: 'string',
          description: 'Directory path to list (e.g. "C:\\\\" on Windows, "/" on Linux). Default: root drive.',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'mesh_power_action',
    description: 'Send a power action to one or more devices.',
    inputSchema: {
      type: 'object',
      properties: {
        node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of device node IDs.',
        },
        action: {
          type: 'string',
          description: 'Power action: "sleep" (3), "reset" (4), "poweroff" (2), "flash" (400), "vibrate" (401).',
          enum: ['sleep', 'reset', 'poweroff', 'flash', 'vibrate'],
        },
      },
      required: ['node_ids', 'action'],
    },
  },
  {
    name: 'mesh_wake_devices',
    description: 'Send Wake-on-LAN packets to wake up one or more devices.',
    inputSchema: {
      type: 'object',
      properties: {
        node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of device node IDs to wake.',
        },
      },
      required: ['node_ids'],
    },
  },
  {
    name: 'mesh_send_toast',
    description: 'Send a toast notification message to one or more devices.',
    inputSchema: {
      type: 'object',
      properties: {
        node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of device node IDs.',
        },
        message: {
          type: 'string',
          description: 'The notification message text.',
        },
      },
      required: ['node_ids', 'message'],
    },
  },
  {
    name: 'mesh_list_users',
    description: 'List all users on the MeshCentral server.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mesh_create_user',
    description: 'Create a new user account on MeshCentral.',
    inputSchema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'Username for the new account.',
        },
        password: {
          type: 'string',
          description: 'Password for the new account.',
        },
        email: {
          type: 'string',
          description: 'Email address for the user.',
        },
        realname: {
          type: 'string',
          description: 'Real name of the user.',
        },
      },
      required: ['username', 'password'],
    },
  },
  {
    name: 'mesh_delete_user',
    description: 'Delete a user account from MeshCentral.',
    inputSchema: {
      type: 'object',
      properties: {
        userid: {
          type: 'string',
          description: 'The user ID to delete (e.g. "user/domain/username").',
        },
      },
      required: ['userid'],
    },
  },
  {
    name: 'mesh_get_events',
    description: 'Get recent events from MeshCentral. Can filter by user or device.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'Filter events for a specific device.',
        },
        userid: {
          type: 'string',
          description: 'Filter events for a specific user.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return. Default: 50.',
        },
      },
    },
  },
  {
    name: 'mesh_get_notes',
    description: 'Get the notes/description for a device.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID.',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'mesh_set_notes',
    description: 'Set or update the notes/description for a device.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID.',
        },
        notes: {
          type: 'string',
          description: 'The notes text to set.',
        },
      },
      required: ['node_id', 'notes'],
    },
  },
  {
    name: 'mesh_change_device_group',
    description: 'Move a device to a different device group.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The device node ID to move.',
        },
        meshid: {
          type: 'string',
          description: 'The target group/mesh ID.',
        },
      },
      required: ['node_id', 'meshid'],
    },
  },
  {
    name: 'mesh_scan_amt',
    description: 'Scan a network range for Intel AMT devices.',
    inputSchema: {
      type: 'object',
      properties: {
        iprange: {
          type: 'string',
          description: 'IP range to scan (e.g. "192.168.1.0/24" or "192.168.1.1-254").',
        },
      },
      required: ['iprange'],
    },
  },
  {
    name: 'mesh_server_info',
    description: 'Get MeshCentral server information and statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
