import * as http2 from 'node:http2';

export interface ApnsHttpRequest {
  host: string;
  path: string;
  authorization: string;
  topic: string;
  body: string;
}

export interface ApnsHttpResponse {
  status: number;
  reason?: string;
}

export type ApnsTransport = (req: ApnsHttpRequest) => Promise<ApnsHttpResponse>;

export const http2ApnsTransport: ApnsTransport = async (input) => {
  const session = http2.connect(`https://${input.host}`);
  try {
    return await new Promise<ApnsHttpResponse>((resolve, reject) => {
      const req = session.request({
        ':method': 'POST',
        ':path': input.path,
        authorization: input.authorization,
        'apns-topic': input.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
      let data = '';
      req.setEncoding('utf8');
      req.on('response', (headers) => {
        const status = Number(headers[':status'] ?? 0);
        req.on('data', (chunk) => {
          data += chunk;
        });
        req.on('end', () => {
          let reason: string | undefined;
          if (data) {
            try {
              reason = (JSON.parse(data) as { reason?: string }).reason;
            } catch {
              reason = undefined;
            }
          }
          resolve({ status, reason });
        });
      });
      req.on('error', reject);
      req.end(input.body);
    });
  } finally {
    session.close();
  }
};
