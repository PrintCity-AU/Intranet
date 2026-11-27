// Checks the Cloudflare Access login check against tokens we sign ourselves. Run with: node test/auth.mjs
import { identify } from '../src/auth.js';
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }));
const b64 = (buf) => Buffer.from(buf).toString('base64url');
async function token(payload, key = privateKey, header = { alg: 'RS256', kid: 'k1' }) {
  const head = b64(JSON.stringify(header)) + '.' + b64(JSON.stringify(payload));
  return head + '.' + b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head)));
}
const env = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud123', DEV_USER_EMAIL: 'dev@example.com' };
const now = Math.floor(Date.now() / 1000);
const good = { email: 'Sam@Example.com', aud: ['aud123'], iss: 'https://team.cloudflareaccess.com', exp: now + 600 };
const req = (t, extra = {}) => new Request('https://x/api/me', { headers: { ...(t ? { 'Cf-Access-Jwt-Assertion': t } : {}), ...extra } });
let failures = 0;
const check = async (name, fn, expect) => {
  let got; try { got = await fn(); } catch (e) { got = 'ERR ' + e.status; }
  const pass = got === expect; if (!pass) failures++;
  console.log(`${pass ? '  ok ' : 'FAIL '} ${name}${pass ? '' : ` (got ${got})`}`);
};
await check('valid token gives the email', async () => identify(req(await token(good)), env), 'sam@example.com');
await check('no token is rejected', () => identify(req(null), env), 'ERR 401');
await check('spoofed dev header is ignored when Access is on', () => identify(req(null, { 'X-Dev-User': 'boss@example.com' }), env), 'ERR 401');
await check('expired token is rejected', async () => identify(req(await token({ ...good, exp: now - 5 })), env), 'ERR 401');
await check('token for another app is rejected', async () => identify(req(await token({ ...good, aud: ['other'] })), env), 'ERR 401');
await check('token from another team is rejected', async () => identify(req(await token({ ...good, iss: 'https://evil.cloudflareaccess.com' })), env), 'ERR 401');
await check('token signed with the wrong key is rejected', async () => identify(req(await token(good, other.privateKey)), env), 'ERR 401');
await check('unsigned ("alg none") token is rejected', async () => identify(req(b64(JSON.stringify({ alg: 'none', kid: 'k1' })) + '.' + b64(JSON.stringify(good)) + '.'), env), 'ERR 401');
await check('tampered payload is rejected', async () => { const t = (await token(good)).split('.'); t[1] = b64(JSON.stringify({ ...good, email: 'boss@example.com' })); return identify(req(t.join('.')), env); }, 'ERR 401');
await check('nothing configured fails closed', () => identify(req(null), {}), 'ERR 503');
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
