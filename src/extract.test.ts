import { describe, expect, it } from 'vitest'
import { recipeIngredients } from '../worker/src/extract'

describe('検索用テキストの抽出', () => {
  it('Recipe構造化データから材料だけを読む', () => {
    expect(
      recipeIngredients({
        '@graph': [
          { '@type': 'WebPage', description: '宣伝文' },
          {
            '@type': ['Recipe', 'CreativeWork'],
            recipeIngredient: [' 鶏むね肉 200g ', '塩 少々', '塩 少々'],
            recipeInstructions: [{ text: '焼く' }],
          },
        ],
      }),
    ).toEqual(['鶏むね肉 200g', '塩 少々'])
  })
})
