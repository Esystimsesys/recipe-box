import { describe, expect, it } from 'vitest'
import {
  isGenericYouTubeDescription,
  recipeIngredients,
  youtubeDescription,
} from '../worker/src/extract'

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

  it('動画固有の概要欄とYouTube共通の案内文を区別する', () => {
    expect(
      isGenericYouTubeDescription(
        'YouTube でお気に入りの動画や音楽を楽しみ、オリジナルのコンテンツをアップロードして友だちや家族、世界中の人たちと共有しましょう。',
      ),
    ).toBe(true)
    expect(isGenericYouTubeDescription('鶏むね肉を使った節約料理です。')).toBe(false)
  })
})
