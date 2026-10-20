import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('node:https', () => ({ default: { request: mock.request } }));
import { safeFetch, parseSafeHttpsUrl, isPublicAddress } from '@/lib/marketing/free-feeds/security/url';

describe('DNS-pinned free-feed transport', () => {
 it('connects to the checked IP with publisher TLS identity and caps the decompressed stream', async () => {
  const optionsSeen: Array<Record<string, unknown>> = [];
  mock.request.mockImplementation((options, callback) => {
   optionsSeen.push(options);
   const request = new EventEmitter() as EventEmitter & { end: () => void };
   request.end = () => {
    const response = Readable.from([gzipSync('x'.repeat(100))]) as Readable & { statusCode: number; headers: Record<string, string> };
    response.statusCode = 200;
    response.headers = { 'content-type': 'application/rss+xml', 'content-encoding': 'gzip' };
    callback(response);
   };
   return request;
  });
  await expect(safeFetch('https://publisher.test/feed', {
   allowHosts: ['publisher.test'], resolveImpl: async () => ['93.184.216.34'], maxBytes: 20,
  })).rejects.toThrow('Decompressed');
  expect(optionsSeen[0]).toMatchObject({ hostname: '93.184.216.34', servername: 'publisher.test', port: 443, path: '/feed', agent: false, headers: { host: 'publisher.test' } });
  expect(typeof optionsSeen[0].checkServerIdentity).toBe('function');
 });
 it.each(['https://[::1]/', 'https://[::ffff:7f00:1]/', 'https://publisher.test:8443/'])('rejects unsafe address or port %s', url => {
  expect(() => parseSafeHttpsUrl(url)).toThrow();
 });
 it('rejects mapped and site-local IPv6 DNS results', () => {
  expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
  expect(isPublicAddress('fec0::1')).toBe(false);
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
 });
 it('rejects special-purpose IPv4 ranges that are not publisher addresses', () => {
  for (const address of ['192.0.0.8', '192.0.2.10', '198.18.0.1', '198.19.255.254', '198.51.100.7', '203.0.113.9', '240.0.0.1']) expect(isPublicAddress(address), address).toBe(false);
  for (const address of ['93.184.216.34', '192.0.1.1', '198.20.0.1', '203.0.114.1']) expect(isPublicAddress(address), address).toBe(true);
 });
});
