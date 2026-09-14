import WebSocket from 'ws';
import crypto from 'crypto';
import https from 'https';
import http from 'http';

export class MeshCentralClient {
  #ws = null;
  #config;
  #pendingRequests = new Map();
  #requestId = 0;
  #connected = false;
  #reconnectTimer = null;
  #messageHandlers = new Map();
  #serverNonce = null;
  #agentCert = null;

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
        headers: {},
      });

      this.#ws.on('open', () => {
        this.#connected = true;
        this.#startMessageLoop();
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
        this.#reconnectTimer = setTimeout(() => {
          this.connect().catch(() => {});
        }, 5000);
      });

      // Kick off inner auth
      this.#ws.on('open', () => {
        this.#ws.send(JSON.stringify({
          action: 'x-meshauth',
          value: '*',
        }));
      });
    });
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
    // Handle response messages
    if (msg.responseid && this.#pendingRequests.has(msg.responseid)) {
      const pending = this.#pendingRequests.get(msg.responseid);
      this.#pendingRequests.delete(msg.responseid);
      clearTimeout(pending.timeout);
      pending.resolve(msg);
      return;
    }

    // Handle typed handlers
    if (msg.action && this.#messageHandlers.has(msg.action)) {
      for (const handler of this.#messageHandlers.get(msg.action)) {
        try { handler(msg); } catch {}
      }
    }

    // Handle event stream
    if (msg.action === 'event') {
      for (const handler of (this.#messageHandlers.get('event') || [])) {
        try { handler(msg); } catch {}
      }
    }
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
    const payload = { ...command, responseid: responseId };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingRequests.delete(responseId);
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.#pendingRequests.set(responseId, { resolve, reject, timeout: timer });

      try {
        this.#ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.#pendingRequests.delete(responseId);
        reject(err);
      }
    });
  }

  async sendAndCollect(command, collectAction, collectTimeout = 30000) {
    if (!this.#connected || !this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to MeshCentral');
    }

    return new Promise((resolve, reject) => {
      const collected = [];
      let off;
      const timer = setTimeout(() => {
        if (off) off();
        if (collected.length === 0) {
          reject(new Error('No response received'));
        } else {
          resolve(collected);
        }
      }, collectTimeout);

      off = this.on(collectAction, (msg) => {
        collected.push(msg);
      });

      try {
        this.#ws.send(JSON.stringify(command));
      } catch (err) {
        clearTimeout(timer);
        if (off) off();
        reject(err);
      }
    });
  }

  disconnect() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#connected = false;
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  get isConnected() {
    return this.#connected;
  }
}
