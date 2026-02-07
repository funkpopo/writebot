/**
 * Network fetch utilities with proxy fallback.
 */

// 本地代理服务器地址
export const LOCAL_PROXY_URL = "https://localhost:53000/api/proxy";

// 是否使用代理（当直接请求失败时自动启用）
export let useProxy = false;

/**
 * 通过本地代理发送请求（解决 CORS 问题）
 */
export async function fetchWithProxy(
  url: string,
  options: RequestInit
): Promise<Response> {
  const proxyUrl = `${LOCAL_PROXY_URL}?target=${encodeURIComponent(url)}`;
  return fetch(proxyUrl, options);
}

/**
 * 智能 fetch：先尝试直接请求，如果遇到 CORS 错误则使用代理
 */
export async function smartFetch(
  url: string,
  options: RequestInit
): Promise<Response> {
  // 如果已知需要使用代理，直接使用代理
  if (useProxy) {
    try {
      return await fetchWithProxy(url, options);
    } catch (proxyError) {
      const errorMsg = proxyError instanceof Error ? proxyError.message : String(proxyError);
      throw new Error(`API 请求失败（通过代理）: ${errorMsg}。请确保本地服务器正在运行。`);
    }
  }

  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    // 检查是否是 CORS 或网络错误
    if (error instanceof TypeError) {
      console.log("直接请求失败，尝试使用本地代理...");
      useProxy = true;
      try {
        return await fetchWithProxy(url, options);
      } catch (proxyError) {
        const errorMsg = proxyError instanceof Error ? proxyError.message : String(proxyError);
        throw new Error(
          `API 请求失败: 直接请求被阻止（可能是 CORS 限制），代理请求也失败: ${errorMsg}。` +
          `请确保本地服务器正在运行，或检查 API 端点是否正确。`
        );
      }
    }
    throw error;
  }
}
