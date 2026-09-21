import type { Recipe } from './domain'
import { restoreRecipes } from './store'

const DEMO_MARKER = 'hitosaji-demo-v1'
const DEMO_NOTE =
  'ローカル動作確認用サンプルです。材料は検索確認用で、元投稿の正確な内容を示すものではありません。作り方は元の投稿をご覧ください。'

const recipe = (
  id: string,
  source: Recipe['source'],
  title: string,
  url: string,
  ingredients: string[],
  favorite: boolean,
  cooked: boolean,
  createdAt: string,
): Recipe => ({
  id,
  kind: 'link',
  title,
  url,
  ingredients,
  note: DEMO_NOTE,
  source,
  photos: [],
  paperPhotos: [],
  logs: [],
  favorite,
  wantToCook: false,
  cooked,
  imageUrl: '',
  createdAt,
  updatedAt: createdAt,
})

/**
 * Local UI fixtures. Titles and ingredients marked as samples are not transcriptions of the posts.
 * The original HTTPS links remain the authoritative source for each recipe.
 */
export const DEMO_RECIPES: Recipe[] = [
  recipe(
    'demo-x-mochi-bolognese',
    'X',
    '餅ボロネーゼ（サンプル）',
    'https://x.com/ore825/status/1089823055684091904',
    ['餅', '合いびき肉', 'トマト'],
    true,
    true,
    '2026-09-21T01:08:00.000Z',
  ),
  recipe(
    'demo-x-soup',
    'X',
    'スープ（サンプル）',
    'https://x.com/ore825/status/1829495020984185205',
    ['豚肉', '白菜', 'ねぎ'],
    false,
    false,
    '2026-09-21T01:07:00.000Z',
  ),
  recipe(
    'demo-instagram-rice-flour-takoyaki',
    'Instagram',
    '米粉たこ焼き（サンプル）',
    'https://www.instagram.com/reel/C6qVNUPyhRc/',
    ['米粉', 'たこ', 'キャベツ'],
    true,
    false,
    '2026-09-21T01:06:00.000Z',
  ),
  recipe(
    'demo-instagram-basque-cheesecake',
    'Instagram',
    'バスク風チーズケーキ（サンプル）',
    'https://www.instagram.com/reel/C8zEmKNyq8I/',
    ['クリームチーズ', '卵', '生クリーム'],
    false,
    true,
    '2026-09-21T01:05:00.000Z',
  ),
  recipe(
    'demo-tiktok-kurashiru-7329796860212808967',
    'TikTok',
    'クラシル動画レシピ1（サンプル）',
    'https://www.tiktok.com/@kurashiru.com/video/7329796860212808967',
    ['鶏肉', '玉ねぎ', 'ピーマン'],
    false,
    false,
    '2026-09-21T01:04:00.000Z',
  ),
  recipe(
    'demo-tiktok-kurashiru-7329424711081938194',
    'TikTok',
    '鶏手羽元の煮物（サンプル）',
    'https://www.tiktok.com/@kurashiru.com/video/7329424711081938194',
    ['鶏手羽元', '大根', '卵'],
    true,
    true,
    '2026-09-21T01:03:00.000Z',
  ),
  recipe(
    'demo-cookpad-19303696',
    'Cookpad',
    'Cookpadサンプル1',
    'https://cookpad.com/jp/recipes/19303696',
    ['じゃがいも', '玉ねぎ', 'にんじん'],
    false,
    true,
    '2026-09-21T01:02:00.000Z',
  ),
  recipe(
    'demo-cookpad-26589682',
    'Cookpad',
    'Cookpadサンプル2',
    'https://cookpad.com/jp/recipes/26589682',
    ['豚肉', 'キャベツ', 'しょうが'],
    true,
    false,
    '2026-09-21T01:01:00.000Z',
  ),
]

let seedInFlight: Promise<void> | undefined

export function seedDemoRecipes(): Promise<void> {
  if (localStorage.getItem(DEMO_MARKER) === 'done') return Promise.resolve()
  if (seedInFlight) return seedInFlight

  seedInFlight = (async () => {
    await restoreRecipes(DEMO_RECIPES)
    // Mark only after the transaction succeeds. A failure remains retryable on the next load.
    localStorage.setItem(DEMO_MARKER, 'done')
  })()

  return seedInFlight.finally(() => {
    seedInFlight = undefined
  })
}
