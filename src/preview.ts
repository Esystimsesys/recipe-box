/** Public OGP image URL used by Cookpad's recipe pages. No recipe HTML or images are copied. */
export function cookpadPreviewUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (
      !['cookpad.com', 'www.cookpad.com'].includes(parsed.hostname) ||
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password
    )
      return ''
    const match = /^\/jp\/recipes\/(\d+)(?:[-/]|$)/.exec(parsed.pathname)
    return match ? `https://og-image.cookpad.com/global/jp/recipe/${match[1]}` : ''
  } catch {
    return ''
  }
}
