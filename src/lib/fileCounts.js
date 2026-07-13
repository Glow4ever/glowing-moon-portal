import { supabase } from './supabase'
import { apiFetch } from './apiFetch'

export async function incrementFileCount(clientId, type, delta) {
  if (!clientId || !delta) return
  try {
    const { error } = await supabase.rpc('increment_file_count', {
      p_client_id: clientId,
      p_count_type: type,
      p_delta: delta
    })
    if (error) console.error('incrementFileCount error:', error)
  } catch (err) {
    console.error('incrementFileCount error:', err)
  }
}

export async function countDropboxFilesRecursive(path) {
  try {
    const res = await apiFetch('/api/dropbox', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'files/list_folder', body: { path, include_deleted: false } })
    })
    if (!res.ok) return 0
    const data = await res.json()
    const entries = data.entries || []
    const counts = await Promise.all(entries.map(async entry => {
      if (entry['.tag'] === 'file') return 1
      if (entry['.tag'] === 'folder') return countDropboxFilesRecursive(entry.path_lower)
      return 0
    }))
    return counts.reduce((sum, n) => sum + n, 0)
  } catch {
    return 0
  }
}

export async function reconcileClientCounts(clientId, clientName) {
  const basePath = `/Glowing Moon Portal/${clientName}`
  const [assetCount, contentCount] = await Promise.all([
    countDropboxFilesRecursive(`${basePath}/Assets`),
    countDropboxFilesRecursive(`${basePath}/Content`)
  ])

  const { error } = await supabase
    .from('clients')
    .update({ asset_count: assetCount, content_count: contentCount })
    .eq('id', clientId)

  if (error) console.error('reconcileClientCounts error:', error)
  return { assetCount, contentCount }
}
