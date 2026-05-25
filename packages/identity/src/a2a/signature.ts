import { err, ok, type Result } from '@confer/shared';

export interface SignatureParams {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
}

export function parseSignatureHeader(header: string): Result<SignatureParams, string> {
  const params: Partial<SignatureParams> = {};

  const regex = /(\w+)="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(header)) !== null) {
    const [, key, value] = match;
    switch (key) {
      case 'keyId':
        params.keyId = value;
        break;
      case 'algorithm':
        params.algorithm = value;
        break;
      case 'headers':
        params.headers = value!.split(' ');
        break;
      case 'signature':
        params.signature = value;
        break;
    }
  }

  if (!params.keyId || !params.signature || !params.headers) {
    return err('Incomplete signature header');
  }

  return ok(params as SignatureParams);
}

export async function verifyRequestSignature(
  _request: Request,
  _publicKey: CryptoKey,
): Promise<Result<true, string>> {
  // TODO: implement RFC 9421 HTTP Message Signatures verification
  return ok(true);
}

export async function signRequest(
  _request: Request,
  _privateKey: CryptoKey,
  _keyId: string,
): Promise<Request> {
  // TODO: implement RFC 9421 HTTP Message Signatures signing
  return _request;
}
