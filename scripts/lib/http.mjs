/**
 * One JSON round trip against the server a gate has booted.
 *
 * Four gates had their own spelling of this — `req`, `post`, `send` and an `api` that throws —
 * differing only in what they do with the result. The round trip itself is the shared part.
 */

/**
 * `body` is `any` on purpose, and so is the parsed response.
 *
 * `Response.json()` is typed `Promise<unknown>`, and every assertion in these gates reads a field
 * off the result. Narrowing each one would mean restating the API's whole response shape inside
 * the very scripts whose job is to catch the server disagreeing with that shape — the check would
 * then be against this file's idea of the API rather than against the API.
 *
 * Never throws on a non-2xx: a 4xx is an assertion subject here at least as often as it is a
 * failure, so the status is returned rather than raised. `ok` rides along for the callers that do
 * want to raise.
 *
 * @param {string} url
 * @param {{ method?: string, body?: any, headers?: Record<string, string>, empty?: any }} [opts]
 *   `empty` is what an unparseable response body becomes — `{}` for the gates that go on to read
 *   fields off it, `null` for the ones that report it.
 * @returns {Promise<{ status: number, ok: boolean, body: any }>}
 */
export async function request(url, { method = 'GET', body, headers, empty = {} } = {}) {
  const res = await fetch(url, {
    method,
    // Spread after the content type, so a caller can override it; and no headers at all when
    // there is no body, which is what a bare GET should send.
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, ok: res.ok, body: await res.json().catch(() => empty) };
}
