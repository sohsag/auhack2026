// Minimal AWS SigV4 signer using Web Crypto API (available in service workers)

const enc = new TextEncoder();

async function hmac(key, data) {
  const k = typeof key === 'string' ? enc.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data)));
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function awsRequest({ accessKeyId, secretAccessKey, region, service, target, body }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const host = `${service}.${region}.amazonaws.com`;
  const url = `https://${host}/`;
  const bodyStr = JSON.stringify(body);
  const payloadHash = await sha256hex(bodyStr);

  const headers = {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Date': amzDate,
    'X-Amz-Target': target,
    'host': host,
  };

  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';
  const canonicalHeaders =
    `content-type:${headers['Content-Type']}\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;

  const canonicalRequest = [
    'POST', '/', '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256hex(canonicalRequest),
  ].join('\n');

  const kDate    = await hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Authorization': authHeader,
    },
    body: bodyStr,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.Message || `AWS error ${res.status}`);
  return data;
}
