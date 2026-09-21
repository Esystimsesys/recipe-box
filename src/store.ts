import { openDB, type DBSchema } from 'idb'
import { parseBackup, exportBackup, type Recipe } from './domain'

interface RecipeDB extends DBSchema {
  recipes: { key: string; value: Recipe }
}
const database = () =>
  openDB<RecipeDB>('hitosaji', 1, {
    upgrade(db) {
      db.createObjectStore('recipes', { keyPath: 'id' })
    },
    blocked() {
      window.dispatchEvent(new Event('recipe-storage-blocked'))
    },
    blocking(_current, _next, event) {
      ;(event.target as IDBDatabase).close()
    },
  })

export async function listRecipes(): Promise<Recipe[]> {
  const db = await database()
  try {
    return (await db.getAll('recipes')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } finally {
    db.close()
  }
}

export async function saveRecipe(recipe: Recipe, previousUpdatedAt?: string) {
  // Apply the same constraints to new records and restored ones.
  recipe = parseBackup(exportBackup([recipe]))[0]
  const db = await database()
  try {
    const tx = db.transaction('recipes', 'readwrite')
    const current = await tx.store.get(recipe.id)
    if (previousUpdatedAt !== undefined && current?.updatedAt !== previousUpdatedAt) {
      await tx.done
      throw new Error(
        '別の画面で記録が変更されています。一度閉じて、最新の内容から編集してください。',
      )
    }
    if (previousUpdatedAt === undefined && current) {
      await tx.done
      throw new Error('同じ記録がすでにあります。もう一度お試しください。')
    }
    await tx.store.put(recipe)
    await tx.done
  } finally {
    db.close()
  }
}

export async function removeRecipe(recipe: Recipe) {
  const db = await database()
  try {
    const tx = db.transaction('recipes', 'readwrite')
    const current = await tx.store.get(recipe.id)
    if (current && current.updatedAt !== recipe.updatedAt) {
      await tx.done
      throw new Error('別の画面で更新されています。最新の記録を確認してから削除してください。')
    }
    await tx.store.delete(recipe.id)
    await tx.done
  } finally {
    db.close()
  }
}

// Restore only missing records in one transaction. An import never overwrites existing work.
export async function restoreRecipes(recipes: Recipe[]) {
  const db = await database()
  try {
    const tx = db.transaction('recipes', 'readwrite')
    let added = 0
    for (const recipe of recipes) {
      if (!(await tx.store.get(recipe.id))) {
        await tx.store.add(recipe)
        added++
      }
    }
    await tx.done
    return added
  } finally {
    db.close()
  }
}

export function friendlyError(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return '保存容量が足りません。バックアップを取ってから、不要な写真を整理してください。入力内容はこの画面に残っています。'
  if (error instanceof Error) return error.message
  return '保存できませんでした。入力内容を確認して、もう一度お試しください。'
}
