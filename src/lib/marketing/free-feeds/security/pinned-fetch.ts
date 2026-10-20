import 'server-only';
import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

/** Connect to an already checked address while retaining the source hostname for TLS and Host. */
export function pinnedSourceFetch(input: string | URL | Request, init: RequestInit | undefined, addresses: readonly string[]): Promise<Response> {
  const url = new URL(String(input));
  if (!addresses.length || url.protocol !== 'https:' || url.port && url.port !== '443') throw new Error('source-connection-invalid');
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: addresses[0], port: 443, servername: url.hostname,
      path: url.pathname + url.search, method: init?.method ?? 'GET',
      headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), host: url.hostname },
      signal: init?.signal ?? undefined,
      checkServerIdentity: (_hostname, certificate) => checkServerIdentity(url.hostname, certificate),
      // A fresh direct connection avoids proxy environments and DNS re-resolution.
      agent: false,
    }, response => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const encoding = headers.get('content-encoding');
      const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
      if (encoding && !decoder && encoding !== 'identity') { response.destroy(); reject(new Error('source-encoding-invalid')); return; }
      if (decoder) {
        headers.delete('content-encoding'); headers.delete('content-length');
        response.on('error', error => decoder.destroy(error));
        decoder.on('close', () => response.destroy());
      }
      const stream = decoder ? response.pipe(decoder) : response;
      const status = response.statusCode ?? 502;
      const noBody = init?.method === 'HEAD' || [204, 205, 304].includes(status);
      if (noBody) response.resume();
      resolve(new Response(noBody ? null : Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers }));
    });
    request.on('error', reject);
    if (typeof init?.body === 'string') request.write(init.body);
    request.end();
  });
}
