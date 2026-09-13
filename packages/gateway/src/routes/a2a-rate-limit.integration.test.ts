import { describe, expect, test } from 'bun:test';
import { apiRequest, headers } from '../test/helpers.js';

// The limiter in front of `/a2a/v1` counted per address and path, and a path that
// carries an id is a new path for every id — so spreading requests over ids met
// no limit at all, while each one still resolved its signer's DID first.
describe('the /a2a/v1 rate limit', () => {
  test('caps one address across every path, not only per path', async () => {
    const ip = 'a2a-ceiling-test';
    const statuses: number[] = [];
    for (let i = 0; i <= 300; i++) {
      const res = await apiRequest(`/a2a/v1/tasks/task-${i}`, { headers: headers({ ip }) });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 300)).not.toContain(429);
    expect(statuses[300]).toBe(429);
  });
});
