/**
 * Minimal, dependency-free WebSocket server (RFC 6455) for the overlay.
 * Supports text/binary messages, fragmentation, ping/pong, close, and
 * exposes the socket's buffered bytes so the game can handle slow clients.
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WsServer extends EventEmitter {
  constructor({ maxPayload = 256 * 1024, heartbeatMs = 20000 } = {}) {
    super();
    this.maxPayload = maxPayload;
    this.clients = new Set();
    this.timer = setInterval(() => this._heartbeat(), heartbeatMs);
    this.timer.unref?.();
  }

  handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (upgrade !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    socket.setTimeout(0);
    const client = new WsClient(socket, this.maxPayload);
    this.clients.add(client);
    client.on('close', () => this.clients.delete(client));
    this.emit('connection', client, req);
    if (head && head.length) client._onData(head);
  }

  _heartbeat() {
    for (const c of this.clients) {
      if (!c.alive) {
        c.terminate();
        continue;
      }
      c.alive = false;
      c._sendFrame(0x9, Buffer.alloc(0));
    }
  }

  close() {
    clearInterval(this.timer);
    for (const c of this.clients) c.close(1001);
  }
}

export class WsClient extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0);
    this.fragOp = 0;
    this.frags = [];
    this.fragSize = 0;
    this.alive = true;
    this.closed = false;
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  get buffered() {
    return this.socket.writableLength;
  }

  _onData(d) {
    this.alive = true;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    this._parse();
  }

  _parse() {
    while (!this.closed) {
      const buf = this.buf;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const rsv = buf[0] & 0x70;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (rsv) return this.close(1002);
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        if (buf.readUInt32BE(2) !== 0) return this.close(1009);
        len = buf.readUInt32BE(6);
        off = 10;
      }
      if (len > this.maxPayload) return this.close(1009);
      if (!masked) return this.close(1002);
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.from(buf.subarray(off, off + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = buf.subarray(off + len);
      this._frame(fin, op, payload);
    }
  }

  _frame(fin, op, p) {
    if (op === 0x8) {
      if (!this.closed) {
        this._sendFrame(0x8, p.subarray(0, 2));
        this.closed = true;
        this.socket.end();
        this.emit('close');
      }
      return;
    }
    if (op === 0x9) return this._sendFrame(0xa, p);
    if (op === 0xa) {
      this.alive = true;
      return;
    }
    if (op === 0x1 || op === 0x2) {
      if (this.fragOp) return this.close(1002);
      if (fin) return this._message(op, p);
      this.fragOp = op;
      this.frags = [p];
      this.fragSize = p.length;
      return;
    }
    if (op === 0x0) {
      if (!this.fragOp) return this.close(1002);
      this.fragSize += p.length;
      if (this.fragSize > this.maxPayload) return this.close(1009);
      this.frags.push(p);
      if (fin) {
        const data = Buffer.concat(this.frags);
        const fop = this.fragOp;
        this.fragOp = 0;
        this.frags = [];
        this.fragSize = 0;
        this._message(fop, data);
      }
      return;
    }
    this.close(1002);
  }

  _message(op, data) {
    this.emit('message', op === 0x1 ? data.toString('utf8') : data, op === 0x2);
  }

  /** Send a string (text frame) or Buffer/Uint8Array (binary frame). */
  send(data) {
    if (this.closed) return;
    if (typeof data === 'string') this._sendFrame(0x1, Buffer.from(data, 'utf8'));
    else this._sendFrame(0x2, Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }

  _sendFrame(op, payload) {
    if (this.socket.destroyed) return;
    const len = payload.length;
    let hdr;
    if (len < 126) {
      hdr = Buffer.alloc(2);
      hdr[1] = len;
    } else if (len < 65536) {
      hdr = Buffer.alloc(4);
      hdr[1] = 126;
      hdr.writeUInt16BE(len, 2);
    } else {
      hdr = Buffer.alloc(10);
      hdr[1] = 127;
      hdr.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
      hdr.writeUInt32BE(len >>> 0, 6);
    }
    hdr[0] = 0x80 | op;
    this.socket.cork();
    this.socket.write(hdr);
    if (len) this.socket.write(payload);
    process.nextTick(() => this.socket.uncork());
  }

  close(code = 1000) {
    if (this.closed) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code, 0);
    this._sendFrame(0x8, b);
    this.closed = true;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2000).unref?.();
    this.emit('close');
  }

  terminate() {
    this.socket.destroy();
    this._closed();
  }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}
