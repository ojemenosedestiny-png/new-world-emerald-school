import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, get, type Server } from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import express from 'express';
import { Storage, type File } from '@google-cloud/storage';
import { objectStorageClient, ObjectStorageService } from './objectStorage';
import storageRouter from '../routes/storage';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function waitUntil(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for upstream cleanup');
}

/**
 * Exercise the actual SDK createReadStream and its internal pipeline. Replace
 * only the network request so tests do not depend on credentials or uploads.
 */
function sdkFixture(mode: 'complete' | 'slow' | 'error' | 'early-error' | 'late-response') {
  const data = Buffer.alloc(128 * 1024, 7);
  const upstreams: Readable[] = [];
  const returned: Readable[] = [];
  const file = objectStorageClient.bucket('test-bucket').file('video.mp4');
  const checksum = file.crc32cGenerator();
  checksum.update(data);
  Object.assign(file, { getMetadata: async () => [{
    size: String(data.length), contentType: 'video/mp4',
    metadata: { 'custom:aclPolicy': JSON.stringify({ visibility: 'public' }) },
  }] });
  const createReadStream = file.createReadStream;
  file.createReadStream = function(options) {
    const stream = createReadStream.call(this, options);
    returned.push(stream);
    return stream;
  };
  Object.assign(file, { requestStream: (options: Parameters<File['requestStream']>[0]) => {
    const upstream = new PassThrough();
    upstreams.push(upstream);
    const rangeHeader = (options.headers as Record<string, string>)?.Range;
    const match = rangeHeader?.match(/bytes=(\d+)-(\d+)/);
    const bytes = match ? data.subarray(Number(match[1]), Number(match[2]) + 1) : data;
    Object.assign(upstream, {
      statusCode: match ? 206 : 200,
      headers: {
        'content-type': 'video/mp4',
        'x-goog-stored-content-encoding': 'identity',
        'x-goog-hash': `crc32c=${checksum.toString()}`,
      },
      toJSON: () => ({ headers: response.headers }),
      request: {},
    });
    // A separate response matches the SDK's request/HTTP-response boundaries.
    const response = upstream as PassThrough & { headers: Record<string, string> };
    const send = () => {
      upstream.emit('response', response);
      if (mode === 'early-error') upstream.destroy(new Error('Storage unavailable'));
      else if (mode === 'complete' || mode === 'late-response') upstream.end(bytes);
      else {
        upstream.write(bytes.subarray(0, 1024));
        if (mode === 'error') setImmediate(() => upstream.destroy(new Error('Storage interrupted')));
      }
    };
    if (mode === 'late-response') setTimeout(send, 30);
    else setImmediate(send);
    return upstream;
  } });
  return { file, data, upstreams, returned };
}

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('a saved product image URL retrieves public photo bytes through the real storage route', async (t) => {
  const fixture = sdkFixture('complete');
  Object.assign(fixture.file, { getMetadata: async () => [{
    size: String(fixture.data.length), contentType: 'image/jpeg',
    metadata: { 'custom:aclPolicy': JSON.stringify({ visibility: 'public' }) },
  }] });
  const originalEntity = ObjectStorageService.prototype.getObjectEntityFile;
  const objectPath = '/objects/uploads/photo-fixture.jpg';
  ObjectStorageService.prototype.getObjectEntityFile = async (path) => {
    assert.equal(path, objectPath);
    return fixture.file;
  };
  const app = express();
  app.use((req, _res, next) => {
    req.log = { error: () => {}, warn: () => {} } as unknown as typeof req.log;
    next();
  });
  app.use('/api', storageRouter);
  const server = createServer(app);
  const origin = await listen(server);
  t.after(async () => {
    ObjectStorageService.prototype.getObjectEntityFile = originalEntity;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  // This is the unchanged imageUrl emitted by product save and public listing.
  const publicProduct = JSON.parse(JSON.stringify({
    imageUrl: `/api/storage${objectPath}`,
  }));
  const response = await fetch(origin + publicProduct.imageUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^image\/jpeg/);
  assert.match(response.headers.get('cache-control') ?? '', /^public/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture.data);
  const obsoleteUrl = await fetch(origin + `/api${objectPath}`);
  assert.equal(obsoleteUrl.status, 404);
});

test('storage routes clean up real SDK streams across plays, seeks, aborts and failures', async (t) => {
  const warnings: Error[] = [];
  const onWarning = (warning: Error) => {
    if (warning.name === 'MaxListenersExceededWarning') warnings.push(warning);
  };
  process.on('warning', onWarning);
  const originalPublic = ObjectStorageService.prototype.searchPublicObject;
  const originalEntity = ObjectStorageService.prototype.getObjectEntityFile;
  let fixture = sdkFixture('complete');
  let delayLookup = false;
  const logs: unknown[] = [];
  const lookup = async () => {
    if (delayLookup) await new Promise((resolve) => setTimeout(resolve, 40));
    return fixture.file;
  };
  ObjectStorageService.prototype.searchPublicObject = lookup;
  ObjectStorageService.prototype.getObjectEntityFile = lookup;
  const app = express();
  const requests: express.Request[] = [];
  const responses: express.Response[] = [];
  app.use((req, res, next) => {
    requests.push(req);
    responses.push(res);
    req.log = { error: (...args: unknown[]) => logs.push(args), warn: () => {} } as unknown as typeof req.log;
    next();
  });
  app.use(storageRouter);
  const server = createServer(app);
  const url = await listen(server);
  t.after(async () => {
    ObjectStorageService.prototype.searchPublicObject = originalPublic;
    ObjectStorageService.prototype.getObjectEntityFile = originalEntity;
    process.off('warning', onWarning);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  for (const path of ['/storage/public-objects/video.mp4', '/storage/objects/video.mp4']) {
    for (let i = 0; i < 24; i++) {
      const range = i % 2 ? 'bytes=1024-2047' : undefined;
      const response = await fetch(url + path, { headers: range ? { Range: range } : {} });
      assert.equal(response.status, range ? 206 : 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, range ? fixture.data.subarray(1024, 2048) : fixture.data);
    }
    const streamCount = fixture.returned.length;
    const head = await fetch(url + path, { method: 'HEAD', headers: { Range: 'bytes=3-8' } });
    assert.equal(head.status, 206);
    assert.equal(head.headers.get('content-range'), `bytes 3-8/${fixture.data.length}`);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const invalid = await fetch(url + path, { headers: { Range: 'bytes=999999-' } });
    assert.equal(invalid.status, 416);
    assert.equal(fixture.returned.length, streamCount);
  }
  await waitUntil(() => fixture.upstreams.every((stream) => stream.closed));
  const initialListenerCounts = fixture.returned.map((stream) =>
    ['error', 'close', 'end'].map((event) => stream.listenerCount(event)));
  assert.ok(initialListenerCounts.every((counts, streamIndex) => counts.every((count, index) =>
    count === initialListenerCounts[streamIndex % 2][index])), 'completed streams have stable listener counts');

  for (const mode of ['slow', 'late-response'] as const) {
    fixture = sdkFixture(mode);
    for (let i = 0; i < 24; i++) {
      await new Promise<void>((resolve, reject) => {
        const request = get(url + '/storage/objects/video.mp4', (response) => {
          response.once('data', () => {
            request.destroy();
            resolve();
          });
        });
        request.on('error', (error) => {
          if (request.destroyed) resolve();
          else reject(error);
        });
        if (mode === 'late-response') {
          void waitUntil(() => fixture.upstreams.length > i).then(() => {
            request.destroy();
            resolve();
          }, reject);
        }
      });
      await waitUntil(() => fixture.returned[i]?.closed && fixture.upstreams[i]?.closed);
    }
    assert.ok(fixture.returned.every((stream) => stream.destroyed));
    const listenerCounts = fixture.returned.map((stream) =>
      ['error', 'close', 'end'].map((event) => stream.listenerCount(event)));
    assert.ok(listenerCounts.every((counts) => counts.every((count, index) =>
      count === listenerCounts[0][index])), 'aborted streams have stable listener counts');
    assert.ok(listenerCounts.flat().every((count) => count < 10));
  }

  // Disconnect during lookup must never open a stream.
  fixture = sdkFixture('complete');
  delayLookup = true;
  const before = requests.length;
  const early = get(url + '/storage/objects/video.mp4');
  early.on('error', () => {});
  await waitUntil(() => requests.length > before);
  early.destroy();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(fixture.returned.length, 0);
  delayLookup = false;

  fixture = sdkFixture('early-error');
  const failure = await fetch(url + '/storage/objects/video.mp4');
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: 'Failed to serve object' });
  fixture = sdkFixture('error');
  await assert.rejects(async () => {
    const response = await fetch(url + '/storage/public-objects/video.mp4');
    await response.arrayBuffer();
  });
  await waitUntil(() => fixture.upstreams.every((stream) => stream.closed));
  await tick();
  assert.equal(logs.length, 2, `only genuine storage failures are logged: ${JSON.stringify(logs)}`);
  assert.deepEqual(warnings, []);
  assert.ok(requests.every((req) => req.listenerCount('aborted') === 0));
  // Node HTTP can retain its own onServerResponseFinish on an aborted socket.
  // Our named handlers must be gone regardless of the transport outcome.
  assert.ok(responses.every((res) => ['finish', 'close', 'error'].every((event) =>
    res.listeners(event).every((listener) =>
      !['disconnect', 'onFinish', 'onResponseClose', 'onError'].includes(listener.name)))));
});

test('the full SDK HTTP transport handles completion, gzip and cancellation without listener warnings', async (t) => {
  const warnings: Error[] = [];
  const onWarning = (warning: Error) => {
    if (warning.name === 'MaxListenersExceededWarning') warnings.push(warning);
  };
  process.on('warning', onWarning);
  const data = Buffer.alloc(128 * 1024, 3);
  const active = new Set<import('node:http').ServerResponse>();
  let mode: 'complete' | 'slow' | 'delayed' | 'gzip' | 'retry' | 'backoff' = 'complete';
  let retryAttempts = 0;
  let total = 0;
  let cancelled = 0;
  const storage = new Storage({ projectId: 'test-project' });
  const checksumOf = (bytes: Buffer) => {
    const checksum = storage.crc32cGenerator();
    checksum.update(bytes);
    return checksum.toString();
  };
  const transport = createServer((req, res) => {
    total++;
    active.add(res);
    res.once('close', () => {
      if (!res.writableFinished) cancelled++;
      active.delete(res);
    });
    if (mode === 'retry' || mode === 'backoff') {
      retryAttempts++;
      if (mode === 'backoff' || retryAttempts === 1) {
        res.statusCode = 503;
        res.end('Temporarily unavailable');
        return;
      }
    }
    const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
    const bytes = range ? data.subarray(Number(range[1]), Number(range[2]) + 1) : data;
    const encoded = mode === 'gzip' ? gzipSync(bytes) : bytes;
    res.statusCode = range ? 206 : 200;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('x-goog-stored-content-encoding', mode === 'gzip' ? 'gzip' : 'identity');
    res.setHeader('x-goog-hash', `crc32c=${checksumOf(encoded)}`);
    if (mode === 'gzip') res.setHeader('Content-Encoding', 'gzip');
    if (mode === 'slow' || mode === 'delayed') {
      let timer: ReturnType<typeof setTimeout>;
      const send = () => {
        res.write(bytes.subarray(0, 1024));
        timer = setTimeout(send, 10);
      };
      timer = setTimeout(send, mode === 'delayed' ? 100 : 0);
      res.once('close', () => clearTimeout(timer));
    } else {
      res.end(encoded);
    }
  });
  const endpoint = await listen(transport);
  const client = new Storage({
    projectId: 'test-project', apiEndpoint: endpoint,
    useAuthWithCustomEndpoint: false,
    retryOptions: { maxRetries: 2, maxRetryDelay: 0.1, totalTimeout: 5 },
  });
  const file = client.bucket('test-bucket').file('video.mp4');
  Object.assign(file, { getMetadata: async () => [{
    size: String(data.length), contentType: 'video/mp4',
  }] });
  const service = new ObjectStorageService();
  t.after(async () => {
    process.off('warning', onWarning);
    transport.closeAllConnections();
    await new Promise<void>((resolve) => transport.close(() => resolve()));
  });
  for (let i = 0; i < 16; i++) {
    const range = i % 2 ? 'bytes=1024-2047' : undefined;
    const download = await service.downloadObject(file, 3600, { range });
    const chunks: Buffer[] = [];
    for await (const chunk of download.body!) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), range ? data.subarray(1024, 2048) : data);
  }
  mode = 'gzip';
  const compressed = await service.downloadObject(file);
  const chunks: Buffer[] = [];
  for await (const chunk of compressed.body!) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), data, 'SDK decompression and integrity validation remain intact');
  await t.test('a retryable 503 response is followed by a successful download', async () => {
    mode = 'retry';
    retryAttempts = 0;
    const download = await service.downloadObject(file);
    const received: Buffer[] = [];
    for await (const chunk of download.body!) received.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(received), data);
    assert.equal(retryAttempts, 2);
  });
  await t.test('cancelling during retry backoff prevents any further requests', async () => {
    mode = 'backoff';
    retryAttempts = 0;
    const download = await service.downloadObject(file);
    const source = download.body!;
    source.on('error', () => {});
    const closed = once(source, 'close');
    source.resume();
    await waitUntil(() => retryAttempts === 1 && active.size === 0);
    // The response has finished and a 100ms retry timer is now pending.
    await new Promise((resolve) => setTimeout(resolve, 20));
    source.destroy();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(retryAttempts, 1, 'cancelled retry must not reach the HTTP server');
  });
  for (const abortMode of ['slow', 'delayed'] as const) {
    mode = abortMode;
    for (let i = 0; i < 8; i++) {
      const download = await service.downloadObject(file);
      const source = download.body!;
      source.on('error', () => {});
      const closed = once(source, 'close');
      if (mode === 'slow') {
        source.once('data', () => source.destroy());
        source.resume();
      } else {
        const previous = total;
        source.resume();
        await waitUntil(() => total > previous);
        source.destroy();
      }
      await closed;
      await waitUntil(() => active.size === 0);
    }
  }
  await tick();
  assert.equal(cancelled, 16, 'every cancelled SDK request closes its HTTP response');
  assert.deepEqual(warnings, []);
});