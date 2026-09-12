import { afterEach, describe, expect, test } from 'bun:test';
import {
  apiBase,
  gatewayOrigin,
  gatewayUrlRequired,
  normalizeGatewayUrl,
  setGatewayUrl,
  websocketUrl,
} from './gateway.js';

afterEach(() => setGatewayUrl(''));

describe('gatewayUrlRequired', () => {
  // What decides this is the origin serving the page, not whether Tauri is
  // present: `tauri dev` runs inside Tauri but loads from the Vite dev server,
  // whose proxy forwards /api and /ws exactly like nginx.
  test('a bundle serving its own assets has to be told', () => {
    expect(gatewayUrlRequired({ protocol: 'tauri:', hostname: 'localhost' })).toBe(true);
    // Windows, Linux and Android — the same bundle, a different scheme.
    expect(gatewayUrlRequired({ protocol: 'http:', hostname: 'tauri.localhost' })).toBe(true);
  });

  test('anything served over http(s) is not', () => {
    expect(gatewayUrlRequired({ protocol: 'http:', hostname: 'localhost' })).toBe(false);
    expect(gatewayUrlRequired({ protocol: 'https:', hostname: 'confer.example.com' })).toBe(false);
  });
});

describe('normalizeGatewayUrl', () => {
  test('accepts what someone would actually type', () => {
    // A bare hostname is what `npx confer-cli --domain` takes and what the
    // deployment docs print, so it is the form to expect first.
    expect(normalizeGatewayUrl('confer.example.com')).toBe('https://confer.example.com');
    expect(normalizeGatewayUrl('  confer.example.com  ')).toBe('https://confer.example.com');
    expect(normalizeGatewayUrl('https://confer.example.com/')).toBe('https://confer.example.com');
    expect(normalizeGatewayUrl('https://confer.example.com/some/path')).toBe(
      'https://confer.example.com',
    );
    // The quick start's own answer: plain HTTP on a port.
    expect(normalizeGatewayUrl('http://localhost:8080')).toBe('http://localhost:8080');
  });

  // Guessing https for a bare hostname is right for a real domain and wrong for
  // the machine the quick start runs on, where nobody has a certificate.
  test('a bare loopback address is guessed as http, everything else as https', () => {
    expect(normalizeGatewayUrl('localhost')).toBe('http://localhost');
    expect(normalizeGatewayUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeGatewayUrl('127.0.0.1')).toBe('http://127.0.0.1');
    expect(normalizeGatewayUrl('confer.example.com')).toBe('https://confer.example.com');
    // An explicit scheme is never second-guessed, in either direction.
    expect(normalizeGatewayUrl('https://localhost')).toBe('https://localhost');
  });

  test('rejects what cannot carry an API', () => {
    expect(normalizeGatewayUrl('')).toBeNull();
    expect(normalizeGatewayUrl('   ')).toBeNull();
    expect(normalizeGatewayUrl('ftp://confer.example.com')).toBeNull();
    // Blocked because it is the shape of an address bar paste that would
    // otherwise be stored and fail much later as an unexplained network error.
    expect(normalizeGatewayUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeGatewayUrl('http://')).toBeNull();
  });
});

describe('URL construction', () => {
  test('unset leaves every URL relative, which is the web build', () => {
    expect(gatewayOrigin()).toBe('');
    expect(apiBase()).toBe('/api/v1');
    // location.origin under happy-dom is http://localhost.
    expect(websocketUrl('/ws?token=t')).toBe('ws://localhost/ws?token=t');
  });

  test('set sends both HTTP and WebSocket to the configured instance', () => {
    setGatewayUrl('https://confer.example.com');
    expect(apiBase()).toBe('https://confer.example.com/api/v1');
    expect(websocketUrl('/ws?token=t')).toBe('wss://confer.example.com/ws?token=t');
  });

  test('an http instance gets ws, not wss', () => {
    setGatewayUrl('http://localhost:8080');
    expect(websocketUrl('/ws?token=t')).toBe('ws://localhost:8080/ws?token=t');
  });

  // The stream URL the gateway hands back is a path — it has no idea which
  // address this client reached it on — so the chat store prefixes it with this.
  test('gatewayOrigin prefixes a server-supplied path', () => {
    setGatewayUrl('https://confer.example.com');
    expect(`${gatewayOrigin()}/api/v1/stream/c1/m1`).toBe(
      'https://confer.example.com/api/v1/stream/c1/m1',
    );
  });

  test('survives a reload', () => {
    setGatewayUrl('https://confer.example.com');
    expect(localStorage.getItem('confer_gateway')).toBe('https://confer.example.com');
    setGatewayUrl('');
    expect(localStorage.getItem('confer_gateway')).toBeNull();
  });
});
