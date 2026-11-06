/** Validate browser writes without trusting arbitrary forwarded-host headers. */
export function checkOrigin(
  request: Request,
  configuration = {
    appOrigin: process.env.APP_ORIGIN,
    development: process.env.NODE_ENV === "development",
  },
) {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin || rawOrigin === "null")
    throw new Error("Invalid request origin");
  let origin: URL;
  let expected: URL;
  const target = new URL(request.url);
  try {
    origin = new URL(rawOrigin);
    expected = new URL(configuration.appOrigin || target.origin);
  } catch {
    throw new Error("Invalid request origin");
  }
  // Origin headers contain a scheme and authority, never credentials or a path.
  if (
    rawOrigin !== origin.origin ||
    !["http:", "https:"].includes(origin.protocol)
  ) {
    throw new Error("Invalid request origin");
  }
  if (origin.origin === expected.origin) return;
  // Next dev may construct request.url using its bind address even when the browser
  // visits localhost. Permit that local alias only when the actual Host agrees.
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    configuration.development &&
    !configuration.appOrigin &&
    loopback.has(origin.hostname) &&
    loopback.has(target.hostname) &&
    origin.protocol === target.protocol &&
    origin.port === target.port &&
    request.headers.get("host")?.toLowerCase() === origin.host
  )
    return;
  throw new Error("Invalid request origin");
}
