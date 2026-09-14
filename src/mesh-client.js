import WebSocket from 'ws';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { FileTunnel } from './file-tunnel.js';

export class MeshCentralClient {
  #ws = null;
  #config;
  #pendingRequests = new Map();
  #pendingByAction = new Map();
  #requestId = 0;
  #connected = false;
  #reconnectTimer = null;
  #messageHandlers = new Map();
  #serverNonce = null;
  #agentCert = null;
  #intentionalClose = false;

  constructor(config) {
    this.#config = {
      serverUrl: config.serverUrl,
      username: config.username,
      password: config.password,
      token: config.token || null,
      domain: config.domain || '',
      rejectUnauthorized: config.rejectUnauthorized !== false,
    };
  }

  #sendUserAuth() {
    const username = Buffer.from(this.#config.username).toString('base64');
    const password = Buffer.from(this.#config.password).toString('base64');
    this.#ws.send(JSON.stringify({
      action: 'userAuth',
      username,
      password,
    }));
  }

  #startMessageLoop() {}

  #handleMessage(msg) {
    // 1) Match by responseid (preferred)
    if (msg.responseid && this.#pendingRequests.has(msg.responseid)) {
      const pending = this.#pendingRequests.get(msg.responseid);
      this.#pendingRequests.delete(msg.responseid);
      clearTimeout(pending.timeout);
      if (pending.actionEntry) {
        const arr = this.#pendingByAction.get(pending.action);
        if (arr) {
          const idx = arr.indexOf(pending);
          if (idx !== -1) arr.splice(idx, 1);
          if (arr.length === 0) this.#pendingByAction.delete(pending.action);
        }
      }
      pending.resolve(msg);
      return;
    }

    // 2) Fallback: some server actions (meshes, users) don't echo responseid —
    //    resolve the oldest pending request for the same action.
    if (msg.action && this.#pendingByAction.has(msg.action)) {
      const arr = this.#pendingByAction.get(msg.action);
      const pending = arr.shift();
      if (arr.length === 0) this.#pendingByAction.delete(msg.action);
      this.#pendingRequests.delete(pending.responseid);
      clearTimeout(pending.timeout);
      pending.resolve(msg);
      return;
    }

    // 3) Dispatch to registered handlers
    if (msg.action && this.#messageHandlers.has(msg.action)) {
      for (const handler of this.#messageHandlers.get(msg.action)) {
        try { handler(msg); } catch {}
      }
    }
    // 4) Wildcard handler (used by waitForMessage)
    if (this.#messageHandlers.has('_any')) {
      for (const handler of this.#messageHandlers.get('_any')) {
        try { handler(msg); } catch {}
      }
    }
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.#config.serverUrl);
      const wsProtocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${urlObj.host}${urlObj.pathname}control.ashx`;

      const agent = new https.Agent({
        rejectUnauthorized: this.#config.rejectUnauthorized,
      });

      this.#ws = new WebSocket(wsUrl, {
        agent: urlObj.protocol === 'https:' ? agent : undefined,
        headers: this.#meshAuthHeaders(),
      });

      this.#ws.on('open', () => {
        this.#connected = true;
        this.#startMessageLoop();
        try {
          this.#ws.send(JSON.stringify({ action: 'ping' }));
        } catch {}
      });

      let authPhase = 0;
      let resolved = false;

      this.#ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString('utf8'));
        } catch {
          return;
        }

        if (msg.action === 'close' && !resolved) {
          resolved = true;
          reject(new Error(`MeshCentral auth failed: ${msg.msg || msg.cause || 'unknown'}`));
          return;
        }

        if (msg.action === 'serverAuth' && authPhase === 0) {
          authPhase = 1;
          this.#serverNonce = msg.nonce;
          this.#agentCert = msg.cert;
          this.#sendUserAuth();
          return;
        }

        if (msg.action === 'serverinfo' && !resolved) {
          resolved = true;
          this.#connected = true;
          resolve(msg);
          return;
        }

        if (!resolved && msg.action && msg.action !== 'close' && authPhase === 0) {
          resolved = true;
          this.#connected = true;
          this.#handleMessage(msg);
          resolve(msg);
          return;
        }

        this.#handleMessage(msg);
      });

      this.#ws.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`WebSocket error: ${err.message}`));
        }
      });

      this.#ws.on('close', () => {
        this.#connected = false;
        this.#pendingRequests.forEach((req) => {
          clearTimeout(req.timeout);
          req.reject(new Error('Connection closed'));
        });
        this.#pendingRequests.clear();
        this.#pendingByAction.clear();
        if (!this.#intentionalClose) {
          this.#reconnectTimer = setTimeout(() => {
            this.connect().catch(() => {});
          }, 5000);
        }
      });
    });
  }

  on(action, handler) {
    if (!this.#messageHandlers.has(action)) {
      this.#messageHandlers.set(action, new Set());
    }
    this.#messageHandlers.get(action).add(handler);
    return () => this.#messageHandlers.get(action)?.delete(handler);
  }

  async sendCommand(command, timeoutMs = 30000) {
    if (!this.#connected || !this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to MeshCentral');
    }

    const responseId = `mcp_${++this.#requestId}`;
    const action = command.action;
    const payload = { ...command, responseid: responseId };

    return new Promise((resolve, reject) => {
      const pending = { responseid: responseId, action, resolve, reject };
      pending.timeout = setTimeout(() => {
        this.#pendingRequests.delete(responseId);
        if (this.#pendingByAction.has(action)) {
          const arr = this.#pendingByAction.get(action);
          const idx = arr.indexOf(pending);
          if (idx !== -1) arr.splice(idx, 1);
          if (arr.length === 0) this.#pendingByAction.delete(action);
        }
        reject(new Error(`Command '${action}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.#pendingRequests.set(responseId, pending);
      if (!this.#pendingByAction.has(action)) this.#pendingByAction.set(action, []);
      this.#pendingByAction.get(action).push(pending);

      try {
        this.#ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(pending.timeout);
        this.#pendingRequests.delete(responseId);
        const arr = this.#pendingByAction.get(action);
        if (arr) {
          const idx = arr.indexOf(pending);
          if (idx !== -1) arr.splice(idx, 1);
          if (arr.length === 0) this.#pendingByAction.delete(action);
        }
        reject(err);
      }
    });
  }

  sendRaw(command) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to MeshCentral');
    }
    this.#ws.send(JSON.stringify(command));
  }

  // Wait for a specific message (e.g. clipboard data routed back as {action:'msg', type:'getclip'})
  waitForMessage(matchFn, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const handler = (msg) => {
        let ok = false;
        try { ok = matchFn(msg); } catch {}
        if (ok) {
          clearTimeout(timer);
          off();
          resolve(msg);
        }
      };
      const timer = setTimeout(() => { off(); reject(new Error('Timed out waiting for message')); }, timeoutMs);
      const off = this.on('_any', handler);
    });
  }

  // Open a remote file tunnel (meshrelay.ashx p=5) to a device
  async openFileTunnel(nodeid, timeoutMs = 25000) {
    // 1. Request an auth cookie for the tunnel
    const cookieResp = await this.sendCommand({ action: 'getcookie', nodeid }, 15000);
    if (!cookieResp.cookie) throw new Error('Server did not return a tunnel auth cookie');

    // 2. Ask the agent to open the other end of the tunnel
    // NOTE: nodeid and cookie are passed RAW (unencoded) - the agent escapes
    // '$' and '@' itself before connecting (MeshCentral base64 alphabet uses those chars).
    // The '*/' prefix tells the agent to resolve the path against its own server URL.
    const tunnelId = crypto.randomBytes(16).toString('hex');
    const query = `p=5&nodeid=${nodeid}&id=${tunnelId}&auth=${cookieResp.cookie}`;
    this.sendRaw({ action: 'msg', type: 'tunnel', nodeid, value: `*/meshrelay.ashx?${query}` });

    // 3. Connect the user side of the tunnel
    const urlObj = new URL(this.#config.serverUrl);
    const wsProtocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${urlObj.host}/meshrelay.ashx?${query}`;
    const agent = urlObj.protocol === 'https:'
      ? new https.Agent({ rejectUnauthorized: this.#config.rejectUnauthorized })
      : undefined;

    const ws = new WebSocket(wsUrl, {
      agent,
      headers: this.#meshAuthHeaders(),
    });

    // Wait for 'c' (both tunnel ends joined), then select file protocol
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error('File tunnel setup timed out (is the device online?)'));
      }, timeoutMs);
      ws.on('message', (data) => {
        const s = data.toString();
        if (s === 'c' || s === 'cr') {
          clearTimeout(timer);
          ws.send('5'); // protocol 5 = remote files
          resolve();
        }
      });
      ws.on('error', (err) => { clearTimeout(timer); reject(new Error(`Tunnel error: ${err.message}`)); });
      ws.on('close', () => { clearTimeout(timer); reject(new Error('Tunnel closed before setup completed')); });
    });

    return new FileTunnel(ws);
  }

  #meshAuthHeaders() {
    const usernameB64 = Buffer.from(this.#config.username).toString('base64');
    const passwordB64 = Buffer.from(this.#config.password).toString('base64');
    return { 'x-meshauth': `${usernameB64},${passwordB64}` };
  }

  disconnect() {
    this.#intentionalClose = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#connected = false;
    if (this.#ws) {
      try { this.#ws.close(); } catch {}
      this.#ws = null;
    }
  }

  get isConnected() {
    return this.#connected;
  }
}
