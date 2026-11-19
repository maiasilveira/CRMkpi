'use strict';
const crypto = require('node:crypto');

const PARAMS = { N: 16384, r: 8, p: 1 };
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha), salt, 32, PARAMS);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
function conferirSenha(senha, armazenado) {
  if (!armazenado || !armazenado.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = armazenado.split('$');
  const h = crypto.scryptSync(String(senha), Buffer.from(saltHex, 'hex'), 32, PARAMS);
  return crypto.timingSafeEqual(h, Buffer.from(hashHex, 'hex'));
}
const tokenAleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

module.exports = { hashSenha, conferirSenha, tokenAleatorio, sha256 };
