// What the control page's health panel shows: is the server healthy, and is chat still arriving?
import { monitorEventLoopDelay } from 'node:perf_hooks';

export class HealthMonitor {
  constructor({ now = () => Date.now(), sampleMs = 2000 } = {}) {
    this.now = now;
    this.sampleMs = sampleMs;
    this.startedAt = now();
    this.lastEventAt = null;
    this.events = []; // timestamps of the last minute
    this.cpuPct = 0;
    this.loopLagMs = 0;
    this.timer = null;
    this.loop = null;
    this.prevCpu = null;
    this.prevAt = 0;
  }

  start() {
    if (this.timer) return;
    this.prevCpu = process.cpuUsage();
    this.prevAt = performance.now();
    this.loop = monitorEventLoopDelay({ resolution: 20 });
    this.loop.enable();
    this.timer = setInterval(() => this.sample(), this.sampleMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.loop?.disable();
  }

  /** CPU use of this process since the last sample, as a percentage of one core. */
  sample() {
    const t = performance.now();
    const used = process.cpuUsage(this.prevCpu);
    const wall = Math.max(1, (t - this.prevAt) * 1000); // microseconds
    this.cpuPct = Math.round(((used.user + used.system) / wall) * 1000) / 10;
    this.prevCpu = process.cpuUsage();
    this.prevAt = t;
    if (this.loop) {
      this.loopLagMs = Math.round((this.loop.percentile(99) / 1e6) * 10) / 10;
      this.loop.reset();
    }
  }

  /** Something arrived from the platform (chat, gift, follow, like). */
  noteEvent() {
    const t = this.now();
    this.lastEventAt = t;
    this.events.push(t);
    if (this.events.length > 20000) this.events.splice(0, this.events.length - 20000);
  }

  snapshot() {
    const t = this.now();
    while (this.events.length && t - this.events[0] > 60000) this.events.shift();
    const mem = process.memoryUsage();
    return {
      uptimeS: Math.round((t - this.startedAt) / 1000),
      rssMb: Math.round(mem.rss / 1048576),
      heapMb: Math.round(mem.heapUsed / 1048576),
      cpuPct: this.cpuPct,
      loopLagMs: this.loopLagMs,
      lastEventAt: this.lastEventAt,
      eventsPerMin: this.events.length,
    };
  }
}
