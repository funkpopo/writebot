export const LOCAL_SERVICE_ORIGIN = "https://localhost:53000";
export const LOCAL_SERVICE_CLIENT_HEADER = "x-writebot-client";
export const LOCAL_SERVICE_CLIENT_VALUE = "writebot-taskpane";

export function buildLocalServiceUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${LOCAL_SERVICE_ORIGIN}${normalizedPath}`;
}

export function withLocalServiceHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  nextHeaders.set(LOCAL_SERVICE_CLIENT_HEADER, LOCAL_SERVICE_CLIENT_VALUE);
  return nextHeaders;
}
