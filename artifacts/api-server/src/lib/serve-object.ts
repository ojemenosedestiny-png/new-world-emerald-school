import type { File } from '@google-cloud/storage';
import type { Request, Response } from 'express';
import { ObjectStorageService } from './objectStorage';
import type { Readable } from 'node:stream';

/**
 * Own the download from lookup through completion. Request "close" is not a
 * disconnect (a completed GET emits it); response "close" is the useful signal.
 */
export async function serveObject(
  req: Request,
  res: Response,
  service: ObjectStorageService,
  resolveFile: () => Promise<File>,
): Promise<void> {
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  req.once('aborted', disconnect);
  res.once('close', disconnect);
  res.once('error', disconnect);
  if (req.aborted || res.destroyed) disconnect();

  try {
    const file = await resolveFile();
    controller.signal.throwIfAborted();
    const download = await service.downloadObject(file, 3600, {
      range: req.get('range'),
      headOnly: req.method === 'HEAD',
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      download.body?.destroy();
      return;
    }
    res.status(download.status);
    download.headers.forEach((value, key) => res.setHeader(key, value));
    if (!download.body) {
      res.end();
      return;
    }
    await pipeObject(download.body, res, controller.signal);
  } catch (error) {
    // A client cancellation is expected, not an application/storage failure.
    if (!controller.signal.aborted) throw error;
  } finally {
    req.off('aborted', disconnect);
    res.off('close', disconnect);
    res.off('error', disconnect);
  }
}

function pipeObject(source: Readable, res: Response, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let ended = false;
    let settled = false;
    let failure: Error | undefined;
    const cleanup = () => {
      source.off('error', onError);
      source.off('end', onEnd);
      source.off('close', onSourceClose);
      res.off('finish', onFinish);
      res.off('close', onResponseClose);
      res.off('error', onError);
      signal.removeEventListener('abort', stop);
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (failure) reject(failure);
      else resolve();
    };
    const stop = () => {
      source.unpipe(res);
      source.destroy();
      // Keep error handling until destroy has completed, including asynchronous
      // errors from the SDK's request teardown.
      if (source.closed) settle();
    };
    const onError = (error: Error) => {
      failure ??= error;
      stop();
    };
    const onEnd = () => { ended = true; };
    const onSourceClose = () => {
      if (!ended && !res.destroyed && !failure) {
        failure = new Error('Object download closed before completion');
      }
      if (failure || res.destroyed || res.writableFinished) settle();
    };
    const onFinish = () => {
      if (source.closed) settle();
    };
    const onResponseClose = () => stop();

    source.once('error', onError);
    source.once('end', onEnd);
    source.once('close', onSourceClose);
    res.once('finish', onFinish);
    res.once('close', onResponseClose);
    res.once('error', onError);
    signal.addEventListener('abort', stop, { once: true });
    if (res.destroyed || signal.aborted) stop();
    else source.pipe(res);
  });
}