// Who is making this request? In production the answer comes from Cloudflare Access,
// which puts a signed token on every request. We verify that token rather than trusting a header.

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let keyCache = { at: 0, keys: [] };

async function accessKeys(teamDomain) {
  if (Date.now() - keyCache.at < 3600_000 && keyCache.keys.length) return keyCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, 'Could not load Cloudflare Access keys');
  const { keys } = await res.json();
  keyCache = { at: Date.now(), keys };
  return keys;
}

const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function verifyAccessJwt(token, teamDomain, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Bad login token');
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { throw new HttpError(401, 'Bad login token'); }
  if (header.alg !== 'RS256') throw new HttpError(401, 'Bad login token');
  let jwk = (await accessKeys(teamDomain)).find((k) => k.kid === header.kid);
  if (!jwk) { keyCache.at = 0; jwk = (await accessKeys(teamDomain)).find((k) => k.kid === header.kid); }
  if (!jwk) throw new HttpError(401, 'Unknown login key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new HttpError(401, 'Login token failed verification');
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new HttpError(401, 'Login expired');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new HttpError(401, 'Login token is for a different application');
  if (payload.iss !== `https://${teamDomain}`) throw new HttpError(401, 'Login token has the wrong issuer');
  if (!payload.email) throw new HttpError(401, 'Login token has no email');
  return payload.email.toLowerCase();
}

function cookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function identify(request, env) {
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (team && env.ACCESS_AUD) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
    if (!token) throw new HttpError(401, 'Not signed in');
    return verifyAccessJwt(token, team, env.ACCESS_AUD);
  }
  // Local development only. Never set DEV_USER_EMAIL on the live site.
  if (env.DEV_USER_EMAIL) {
    return (request.headers.get('X-Dev-User') || cookie(request, 'dev_user') || env.DEV_USER_EMAIL).toLowerCase();
  }
  throw new HttpError(503, 'Login is not set up yet. Add ACCESS_TEAM_DOMAIN and ACCESS_AUD in the Cloudflare Pages settings.');
}

export async function currentUser(request, env) {
  const email = await identify(request, env);
  const db = env.DB;
  const now = new Date().toISOString();
  const admins = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  let user = await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first();
  if (!user) {
    const name = email.split('@')[0].split(/[._-]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    await db.prepare(`INSERT INTO users (email, name, role, active, created_at, last_seen) VALUES (?,?,?,1,?,?)`)
      .bind(email, name, admins.includes(email) ? 'admin' : 'staff', now, now).run();
    user = await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first();
  } else {
    if (admins.includes(email) && user.role !== 'admin') {
      await db.prepare(`UPDATE users SET role='admin', active=1 WHERE id=?`).bind(user.id).run();
      user.role = 'admin'; user.active = 1;
    }
    if (!user.last_seen || now.slice(0, 13) !== user.last_seen.slice(0, 13)) {
      await db.prepare(`UPDATE users SET last_seen=? WHERE id=?`).bind(now, user.id).run();
    }
  }
  if (!user.active) throw new HttpError(403, 'Your account has been turned off. Speak to your manager.');
  return user;
}
