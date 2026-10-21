// Avatar circle: the viewer's TikTok picture, or their initials on a colour picked from their id.
const COLORS = ['#ff8a5c', '#5cc8ff', '#5ee6a8', '#ffd25c', '#c79bff', '#ff8cb0', '#6ee8e0', '#ffb08a', '#9fb4ff', '#d4f06a'];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function initials(name) {
  const clean = String(name || '?').replace(/^@/, '').replace(/[^a-zA-Z0-9]/g, '');
  return (clean.slice(0, 2) || '?').toUpperCase();
}

export function avatarColor(user) {
  return COLORS[hash(String(user?.id ?? user?.name ?? '?')) % COLORS.length];
}

/** Returns an element; falls back to initials when the picture is missing or fails to load. */
export function avatarEl(user, cls = '') {
  const el = document.createElement('span');
  el.className = `avatar ${cls}`.trim();
  const fallback = () => {
    el.textContent = initials(user?.name);
    el.style.background = avatarColor(user);
  };
  if (user?.avatar) {
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onerror = () => {
      img.remove();
      fallback();
    };
    img.src = user.avatar;
    el.style.background = avatarColor(user);
    el.appendChild(img);
  } else fallback();
  return el;
}
