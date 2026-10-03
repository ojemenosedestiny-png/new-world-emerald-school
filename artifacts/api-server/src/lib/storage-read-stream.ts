import type { File, CreateReadStreamOptions } from '@google-cloud/storage';
import type { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';

/**
 * The SDK only connects its request to the returned stream after HTTP headers
 * arrive. Closing that stream earlier otherwise leaves a request alive and
 * makes a late response call pipeline() with an already-destroyed destination.
 * Intercept only this download's request; never mutate a shared File instance.
 */
export function storageReadStream(file: File, options?: CreateReadStreamOptions): Readable {
  const scopedFile = Object.create(file) as File;
  let stream: Readable;
  scopedFile.requestStream = (requestOptions) => {
    const request = file.requestStream(requestOptions);
    const cancelRequest = () => {
      if (!stream.readableEnded) {
        // The SDK's runtime duplex request exposes abort(), though its public
        // Request type omits it. destroy() also covers pre-authentication reads.
        (request as typeof request & { abort?: () => void }).abort?.();
        request.destroy();
      }
    };
    stream.once('close', cancelRequest);
    // Preserve the SDK's request error handling, resume, validation and gzip
    // behavior. Only gate its response callback after consumer cancellation.
    const guardedRequest = new Proxy(request, {
      get(target, property) {
        if (property === 'on') {
          return (event: string, listener: (...args: unknown[]) => void) => {
            if (event === 'response') {
              target.on(event, (response: Readable & {
                statusCode: number; headers: Record<string, string>;
                request: unknown; toJSON: () => unknown;
              }) => {
                if (stream.destroyed) {
                  response.destroy();
                  return;
                }
                // node-fetch, teeny-request and GCS otherwise pipeline the
                // same raw body. Give GCS its own stream boundary rather than
                // stacking a third pipeline's listeners on that body.
                const body = new PassThrough();
                Object.assign(body, {
                  statusCode: response.statusCode,
                  headers: response.headers,
                  request: response.request,
                  toJSON: response.toJSON.bind(response),
                });
                const onError = (error: Error) => body.destroy(error);
                const onClose = () => {
                  if (!response.readableEnded) {
                    body.destroy(new Error('Storage response closed before completion'));
                  }
                };
                response.once('error', onError);
                response.once('close', onClose);
                body.once('close', () => {
                  response.unpipe(body);
                  response.off('error', onError);
                  response.off('close', onClose);
                  if (!response.readableEnded) response.destroy();
                });
                listener(body);
                response.pipe(body);
              });
            } else {
              target.on(event, listener);
            }
            return guardedRequest;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return guardedRequest;
  };
  // SDK streams start their request lazily on the first read, after assignment.
  stream = scopedFile.createReadStream(options);
  return stream;
}