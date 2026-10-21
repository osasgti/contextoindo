// JSON WebSocket with auto-reconnect.
export class Net {
  constructor({ role = 'overlay', key = '', onState, onEvt, onMessage, onOpen, onClose } = {}) {
    this.role = role;
    this.key = key;
    this.h = { onState, onEvt, onMessage, onOpen, onClose };
    this.delay = 800;
    this.ws = null;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = new URLSearchParams({ role: this.role });
    if (this.key) q.set('key', this.key);
    const ws = new WebSocket(`${proto}//${location.host}/ws?${q}`);
    this.ws = ws;
    ws.onopen = () => {
      this.delay = 800;
      this.h.onOpen?.();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'state') this.h.onState?.(msg);
      else if (msg.t === 'evt') this.h.onEvt?.(msg.evt);
      else this.h.onMessage?.(msg);
    };
    ws.onclose = () => {
      this.h.onClose?.();
      setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(this.delay * 1.6, 8000);
    };
    ws.onerror = () => ws.close();
  }

  send(msg) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }
}
