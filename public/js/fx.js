// Confetti for wins and the heart burst for likes. Both stay off with reduced motion.
const reduced = () => document.documentElement.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

const CONFETTI_COLORS = ['#ffcf5c', '#ff7a3c', '#43e6a3', '#5ec8ff', '#ff8cab', '#ffffff'];

export class Confetti {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.running = false;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    addEventListener('resize', fit);
  }

  burst(count = 180) {
    if (reduced()) return;
    const w = innerWidth;
    const h = innerHeight;
    for (let i = 0; i < count; i++) {
      const fromLeft = i % 2 === 0;
      this.parts.push({
        x: (fromLeft ? 0.06 : 0.94) * w + (Math.random() - 0.5) * w * 0.06,
        y: h * (0.58 + Math.random() * 0.12),
        vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 9) * (w / 1920),
        vy: -(10 + Math.random() * 12) * (h / 1080),
        g: 0.32 * (h / 1080),
        size: (7 + Math.random() * 9) * (w / 1920),
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        life: 0,
        max: 150 + Math.random() * 70,
        shape: Math.random() < 0.3 ? 'circle' : 'rect',
      });
    }
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this._frame());
    }
  }

  _frame() {
    const c = this.ctx;
    c.clearRect(0, 0, innerWidth, innerHeight);
    this.parts = this.parts.filter((p) => p.life < p.max);
    for (const p of this.parts) {
      p.life++;
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const fade = Math.min(1, (p.max - p.life) / 40);
      c.save();
      c.globalAlpha = fade;
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.fillStyle = p.color;
      if (p.shape === 'circle') {
        c.beginPath();
        c.arc(0, 0, p.size * 0.4, 0, Math.PI * 2);
        c.fill();
      } else c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2.2);
      c.restore();
    }
    if (this.parts.length) requestAnimationFrame(() => this._frame());
    else {
      this.running = false;
      c.clearRect(0, 0, innerWidth, innerHeight);
    }
  }
}

const HEART = '<svg viewBox="0 0 24 24"><path fill="url(#hg)" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 2.8 4.5 6.6 4.2c2.1-.2 3.9 1 5.4 2.9 1.5-1.9 3.3-3.1 5.4-2.9 3.8.3 5.7 4.3 4.2 7.6C19.5 16.4 12 21 12 21z"/><defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9cb7"/><stop offset="1" stop-color="#ff3d6e"/></linearGradient></defs></svg>';

export class Hearts {
  constructor(el, { max = 40 } = {}) {
    this.el = el;
    this.max = max;
  }

  /** Display only: a few hearts per like batch, never a call to action. */
  burst(likes = 1) {
    if (reduced()) return;
    const n = Math.min(10, 2 + Math.round(Math.log2(1 + likes) * 2));
    for (let i = 0; i < n; i++) {
      if (this.el.childElementCount >= this.max) return;
      const h = document.createElement('div');
      h.className = 'heart';
      h.innerHTML = HEART;
      const size = 24 + Math.random() * 22;
      h.style.width = h.style.height = `${size}px`;
      h.style.left = `${20 + Math.random() * 60}%`;
      h.style.setProperty('--dx', `${(Math.random() - 0.5) * 140}px`);
      h.style.setProperty('--rot', `${(Math.random() - 0.5) * 50}deg`);
      h.style.setProperty('--dur', `${2.2 + Math.random() * 1.4}s`);
      h.style.animationDelay = `${i * 90}ms`;
      h.addEventListener('animationend', () => h.remove());
      this.el.appendChild(h);
    }
  }
}
