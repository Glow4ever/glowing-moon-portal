const BASE_PATH = '/Glowing Moon Portal'

async function dbxFetch(endpoint, body) {
  const res = await fetch('/api/dropbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ endpoint, body })
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('Dropbox API error:', res.status, text)
    throw new Error(`Dropbox API error: ${res.status}`)
  }
  return res.json()
}

async function listFolder(path) {
  try {
    const data = await dbxFetch('files/list_folder', {
      path,
      include_deleted: false
    })
    return data.entries || []
  } catch (err) {
    console.error('listFolder error:', err)
    return []
  }
}

export async function getClientYears(clientName) {
  const entries = await listFolder(BASE_PATH)
  const years = entries
    .filter(e => e['.tag'] === 'folder' && /^\d{4}$/.test(e.name))
    .map(e => e.name)
    .sort((a, b) => b - a)
  return years
}

export async function getContentFolders(clientName, year) {
  const entries = await listFolder(`${BASE_PATH}/${year}/${clientName}/Content`)
  return entries.filter(e => e['.tag'] === 'folder')
}

export async function getContentFiles(clientName, year, folderName) {
  const entries = await listFolder(`${BASE_PATH}/${year}/${clientName}/Content/${folderName}`)
  return entries.filter(e => e['.tag'] === 'file')
}

export async function getAssetFolders(clientName, year) {
  const entries = await listFolder(`${BASE_PATH}/${year}/${clientName}/Assets`)
  return entries.filter(e => e['.tag'] === 'folder')
}

export async function getAssetFiles(clientName, year, folderName) {
  const entries = await listFolder(`${BASE_PATH}/${year}/${clientName}/Assets/${folderName}`)
  return entries.filter(e => e['.tag'] === 'file')
}

export async function getDownloadLink(pathLower) {
  try {
    const data = await dbxFetch('files/get_temporary_link', { path: pathLower })
    return data.link
  } catch (err) {
    console.error('getDownloadLink error:', err)
    return null
  }
}

export async function getPreviewLink(pathLower) {
  try {
    const data = await dbxFetch('files/get_temporary_link', { path: pathLower })
    return data.link
  } catch (err) {
    console.error('getPreviewLink error:', err)
    return null
  }
}

export async function uploadFile(relativePath, fileData) {
  try {
    const res = await fetch('/api/dropbox-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: `${BASE_PATH}/${relativePath}`,
        fileData: Array.from(new Uint8Array(fileData))
      })
    })
    if (!res.ok) throw new Error(`Upload error: ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('uploadFile error:', err)
    return null
  }
}

export async function deleteFile(pathLower) {
  try {
    await dbxFetch('files/delete_v2', { path: pathLower })
    return true
  } catch (err) {
    console.error('deleteFile error:', err)
    return false
  }
}

export async function deleteFolder(pathLower) {
  try {
    await dbxFetch('files/delete_v2', { path: pathLower })
    return true
  } catch (err) {
    console.error('deleteFolder error:', err)
    return false
  }
}

export async function createFolder(relativePath) {
  try {
    await dbxFetch('files/create_folder_v2', {
      path: `${BASE_PATH}/${relativePath}`,
      autorename: false
    })
    return true
  } catch (err) {
    console.error('createFolder error:', err)
    return false
  }
}

export function getFileType(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['mp4','mov','avi','webm','m4v'].includes(ext)) return 'video'
  if (['jpg','jpeg','png','gif','webp','heic'].includes(ext)) return 'photo'
  if (['pdf'].includes(ext)) return 'pdf'
  if (['zip','rar'].includes(ext)) return 'zip'
  return 'other'
}

export function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
