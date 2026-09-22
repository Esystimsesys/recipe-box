export function recipeIngredients(value: unknown): string[] {
  const found: string[] = []
  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const item = node as Record<string, unknown>
    const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']]
    if (types.some((type) => typeof type === 'string' && /(?:^|\/)Recipe$/iu.test(type))) {
      const values = item.recipeIngredient || item.ingredients
      if (Array.isArray(values)) {
        for (const value of values) {
          if (typeof value === 'string')
            found.push(value.replace(/\s+/gu, ' ').trim().slice(0, 120))
        }
      }
    }
    if (item['@graph']) visit(item['@graph'])
  }
  visit(value)
  return [...new Set(found.filter(Boolean))].slice(0, 200)
}

export function youtubeDescription(script: string, maxLength = 30_000): string {
  const match = /"shortDescription"\s*:\s*("(?:\\.|[^"\\])*")/u.exec(script)
  if (!match) return ''
  try {
    return (JSON.parse(match[1]) as string).trim().slice(0, maxLength)
  } catch {
    return ''
  }
}

export function isGenericYouTubeDescription(value: string): boolean {
  const text = value.replace(/\s+/gu, ' ').trim()
  return (
    text.startsWith('YouTube でお気に入りの動画や音楽を楽しみ') ||
    text.startsWith('Enjoy the videos and music you love, upload original content')
  )
}
