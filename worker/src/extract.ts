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
