# Permission Control Design — MeshCentral MCP

Status: **proposal / not yet implemented**

---

## 1. The problem

The MCP server registers **58 tools unconditionally**. Every one of them is
handed to the model the moment the server starts, and every one executes against a single
MeshCentral account supplied through `MESH_USERNAME` / `MESH_PASSWORD`. There is no
allow-list, no tiering, no confirmation step, no audit trail and no scoping.

Key risks:
- Arbitrary code execution as SYSTEM/root on any managed device
- Arbitrary read/write/delete of any remote file
- Agent removal / core replacement
- Identity and access management (privilege escalation)
- Server console access

---

## 2. Layer 0 — MeshCentral-side least privilege (do this first)

Create an `mcp-bot` user with `siteadmin = 0`. Grant device access per group
through a user group link with an explicit bitmask.

### Login tokens instead of a password

Create a login token in the MeshCentral web UI under **My Account → Login tokens**.
MeshCentral returns a **pair**: a token username (always prefixed `~t:`) and a token
password. Both are required. Tokens can be given an expiry and revoked without changing
the account password.

```
MESH_TOKEN_USER=~t:xxxxxxxxxxxxxxxx
MESH_TOKEN_PASS=xxxxxxxxxxxxxxxxxxxx
```

Or combined:
```
MESH_TOKEN=~t:xxxxxxxxxxxxxxxx,xxxxxxxxxxxxxxxxxxxx
```

---

## 3. Layer 1 — Capability tiers

| Tier | Meaning |
|------|---------|
| **R** | Read / inventory (no mutation) |
| **RF** | Remote data read (exfiltration risk) |
| **W** | Low-impact write (reversible, metadata) |
| **X** | Remote code execution |
| **WF** | Remote file write (destruction / persistence) |
| **P** | Disruptive / agent lifecycle |
| **A** | Estate / IAM administration |

### Built-in profiles

| Profile | Tiers | Confirmation |
|---------|-------|-------------|
| `readonly` **(default)** | R | — |
| `support` | R, RF, W, X | X confirmed |
| `operations` | R, RF, W, X, WF, P | X, WF, P confirmed |
| `admin` | all | X, WF, P, A confirmed |

---

## 4. Local file access

`mesh_file_download` and `mesh_file_upload` are the only tools that touch the disk
of the machine running this server. They are confined to `MESH_LOCAL_FILE_ROOT`
(default `./mcp-files`, created on startup); paths outside it — including via `..`
or a symbolic link — are rejected.

Setting `MESH_LOCAL_FILE_ROOT=*` removes the restriction and lets the agent read and
write anywhere the process can, including its own `.env`. Not recommended.

---

## 5. Recommendations

1. **Use a dedicated, non-admin service account** — never point the MCP at a full site administrator
2. **Use login tokens** instead of account passwords — set a non-zero expiry
3. **Withhold `MESHRIGHT_REMOTECOMMAND`** if the agent never needs to run commands
4. **Enable consent flags** on device groups for terminal/desktop/file sessions
5. **Keep `MESH_LOCAL_FILE_ROOT`** restricted to a dedicated directory
