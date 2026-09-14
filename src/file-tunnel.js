import crypto from 'crypto';

const BLOCK_MORE = 0x01000000;
const BLOCK_LAST = 0x01000001;
const DATA_BLOCK_SIZE = 16380;

// Implements MeshCentral's remote file protocol (meshrelay.ashx p=5)
export class FileTunnel {
  #ws;
  #reqId = 0;
  #pending = new Map();
  #uploadWaiters = new Map();
  #downloadState = null;
  #findState = null;
  #closed = false;
  onDebug = null; // optional callback for debugging: (direction, data) => {}

  constructor(ws) {
    this.#ws = ws;
    ws.on('message', (data) => this.#onData(data));
    ws.on('close', () => {
      this.#closed = true;
      this.#pending.forEach((p) => {
        clearTimeout(p.timer);
        p.reject(new Error('Tunnel closed'));
      });
      this.#pending.clear();
      if (this.#downloadState) {
        clearTimeout(this.#downloadState.timer);
        this.#downloadState.reject(new Error('Tunnel closed during download'));
        this.#downloadState = null;
      }
    });
    ws.on('error', () => {});
  }

  get isOpen() {
    return !this.#closed && this.#ws.readyState === 1;
  }

  #onData(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (this.onDebug) { try { this.onDebug('recv', buf); } catch {} }
    if (buf.length > 0 && buf[0] === 123) {
      // JSON message ('{')
      let msg;
      try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
      this.#onJson(msg);
    } else {
      // Binary block -> download data
      if (this.#downloadState) this.#onDownloadBlock(buf);
    }
  }

  #onJson(msg) {
    // Resolve by reqid first
    if (msg.reqid && this.#pending.has(msg.reqid)) {
      const p = this.#pending.get(msg.reqid);
      this.#pending.delete(msg.reqid);
      clearTimeout(p.timer);

      // Upload ack flow: uploadack/uploaddone resolve waiters instead of the main pending
      if (msg.action === 'uploadack' && this.#uploadWaiters.has(msg.reqid)) {
        const w = this.#uploadWaiters.get(msg.reqid);
        w.resolve(msg);
        return;
      }
      p.resolve(msg);
      return;
    }
    if (msg.action === 'uploadack' && this.#uploadWaiters.has(msg.reqid)) {
      const w = this.#uploadWaiters.get(msg.reqid);
      this.#uploadWaiters.delete(msg.reqid);
      clearTimeout(w.timer);
      w.resolve(msg);
      return;
    }
    // Download lifecycle messages
    if (this.#downloadState && msg.id === this.#downloadState.id) {
      if (msg.action === 'download' && msg.sub === 'start') {
        // Agent opened the file, start streaming
        this.#sendJson({ action: 'download', sub: 'startack', id: this.#downloadState.id, ack: 4 });
        return;
      }
      if (msg.action === 'download' && msg.sub === 'cancel') {
        clearTimeout(this.#downloadState.timer);
        const { reject } = this.#downloadState;
        this.#downloadState = null;
        reject(new Error('Download cancelled by agent (file not found or busy)'));
        return;
      }
    }
    // findfile results
    if (this.#findState && msg.action === 'findfile' && msg.reqid === this.#findState.reqid) {
      if (msg.r === null || msg.r === undefined) {
        clearTimeout(this.#findState.timer);
        const { resolve } = this.#findState;
        const results = this.#findState.results;
        this.#findState = null;
        resolve(results);
      } else {
        this.#findState.results.push(msg.r);
      }
      return;
    }
  }

  #onDownloadBlock(buf) {
    const state = this.#downloadState;
    if (buf.length < 4) return;
    const header = buf.readInt32BE(0);
    state.chunks.push(buf.slice(4));
    if (header === BLOCK_LAST) {
      clearTimeout(state.timer);
      const data = Buffer.concat(state.chunks);
      this.#downloadState = null;
      state.resolve(data);
    } else {
      this.#sendJson({ action: 'download', sub: 'ack', id: state.id });
    }
  }

  #sendJson(obj) {
    if (this.onDebug) { try { this.onDebug('send', Buffer.from(JSON.stringify(obj))); } catch {} }
    this.#ws.send(JSON.stringify(obj));
  }

  #request(cmd, timeoutMs = 15000, reqidOverride = null) {
    return new Promise((resolve, reject) => {
      const reqid = reqidOverride || `ft_${++this.#reqId}`;
      const pending = { reqid, resolve, reject };
      pending.timer = setTimeout(() => {
        this.#pending.delete(reqid);
        reject(new Error(`File operation '${cmd.action}' timed out`));
      }, timeoutMs);
      this.#pending.set(reqid, pending);
      this.#sendJson({ ...cmd, reqid });
    });
  }

  async #waitUploadAck(reqid, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      w.timer = setTimeout(() => {
        this.#uploadWaiters.delete(reqid);
        reject(new Error('Upload ack timed out'));
      }, timeoutMs);
      this.#uploadWaiters.set(reqid, w);
    });
  }

  // ── Public operations ─────────────────────────────────────────────

  async list(path, timeoutMs = 15000) {
    const resp = await this.#request({ action: 'ls', path }, timeoutMs);
    if (resp.dir == null) throw new Error(`Path not found or inaccessible: ${path}`);
    return resp.dir;
  }

  async mkdir(path) {
    this.#sendJson({ action: 'mkdir', path });
  }

  async mkfile(path) {
    this.#sendJson({ action: 'mkfile', path });
  }

  async delete(path, names, recursive = false) {
    this.#sendJson({ action: 'rm', path, delfiles: names, rec: recursive });
  }

  async rename(path, oldname, newname) {
    this.#sendJson({ action: 'rename', path, oldname, newname });
  }

  async copy(scpath, dspath, names) {
    this.#sendJson({ action: 'copy', scpath, dspath, names });
  }

  async move(scpath, dspath, names) {
    this.#sendJson({ action: 'move', scpath, dspath, names });
  }

  async download(path, timeoutMs = 120000) {
    if (this.#downloadState) throw new Error('Another download is in progress');
    const id = crypto.randomBytes(8).toString('hex');
    return new Promise((resolve, reject) => {
      const state = { id, chunks: [], resolve, reject };
      state.timer = setTimeout(() => {
        this.#sendJson({ action: 'download', sub: 'stop', id });
        this.#downloadState = null;
        reject(new Error('Download timed out'));
      }, timeoutMs);
      this.#downloadState = state;
      this.#sendJson({ action: 'download', sub: 'start', path, id });
    });
  }

  async upload(dirPath, name, data, timeoutMs = 120000) {
    const reqid = `up_${++this.#reqId}`;
    // Request upload (agent replies uploadstart with this reqid)
    const startResp = await this.#request({ action: 'upload', path: dirPath, name }, timeoutMs, reqid);
    if (startResp.action === 'uploaderror') throw new Error('Upload rejected by remote device');
    // Send data blockwise; agent sends uploadack per block
    for (let offset = 0; offset < data.length; offset += DATA_BLOCK_SIZE) {
      const block = data.slice(offset, offset + DATA_BLOCK_SIZE);
      const frame = Buffer.concat([Buffer.from([0]), block]); // 0x00 escape prefix
      const ackPromise = this.#waitUploadAck(reqid, timeoutMs);
      this.#ws.send(frame);
      await ackPromise;
    }
    // Finish
    const done = await new Promise((resolve, reject) => {
      const pending = { reqid, resolve, reject };
      pending.timer = setTimeout(() => {
        this.#pending.delete(reqid);
        reject(new Error('Upload finish timed out'));
      }, timeoutMs);
      this.#pending.set(reqid, pending);
      this.#sendJson({ action: 'uploaddone', reqid });
    });
    if (done.action === 'uploaderror') throw new Error('Upload error on remote device');
    return true;
  }

  async find(path, filter, timeoutMs = 20000) {
    if (this.#findState) throw new Error('Another search is in progress');
    const reqid = `find_${++this.#reqId}`;
    return new Promise((resolve, reject) => {
      const state = { reqid, results: [], resolve, reject };
      state.timer = setTimeout(() => {
        const results = state.results;
        this.#findState = null;
        resolve(results);
      }, timeoutMs);
      this.#findState = state;
      this.#sendJson({ action: 'findfile', path, filter, reqid });
    });
  }

  close() {
    if (this.#downloadState) {
      try { this.#sendJson({ action: 'download', sub: 'stop', id: this.#downloadState.id }); } catch {}
    }
    this.#closed = true;
    try { this.#ws.close(); } catch {}
  }
}
