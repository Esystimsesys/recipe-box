import { describe, expect, it } from 'vitest'
import { recipeIngredients, youtubeDescription } from '../worker/src/extract'

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

  it('YouTubeページのJSONから改行付き概要欄を読む', () => {
    expect(
      youtubeDescription(`window.ytInitialPlayerResponse = {"shortDescription":"鶏肉\\n玉ねぎ"};`),
    ).toBe('鶏肉\n玉ねぎ')
  })
})
