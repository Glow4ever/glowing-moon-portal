const ACCESS_TOKEN = import.meta.env.VITE_DROPBOX_ACCESS_TOKEN
const BASE_PATH = '/Commercial/Glowing Moon Portal'

async function dbxFetch(endpoint, body) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Dropbox API error: ${res.status}`)
  return res.json()
}

async function dbxContentFetch(endpoint, args, body) {
  const res = await fetch(`https://content.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Dropbox-API-Arg': JSON.stringify(args),
      'Content-Type': 'application/octet-stream',
    },
    body
  })
  if (!res.ok) throw new Error(`Dropbox content API error: ${res.status}`)
  return res.json()
}

// List folders/files at a path
export async function listFolder(path) {
  try {
    const data = await dbxFetch('files/list_folder', { path, include_deleted: false })
    return data.entries || []
  } catch (err) {
    console.error('listFolder error:', err)
    return []
  }
}

// Get years available for a client
export async function getClientYears(clientName) {
  const path = `${BASE_PATH}`
  const entries = await listFolder(path)
  const years = entries
    .filter(e => e['.tag'] === 'folder' && /^\d{4}$/.test(e.name))
    .map(e => e.name)
    .sort((a, b) => b - a) // newest first
  return years
}

// Get content folders for a client/year
export async function getContentFolders(clientName, year) {
  const path = `${BASE_PATH}/${year}/${clientName}/Content`
  const entries = await listFolder(path)
  return entries.filter(e => e['.tag'] === 'folder')
}

// Get files inside a content folder
export async function getContentFiles(clientName, year, folderName) {
  const path = `${BASE_PATH}/${year}/${clientName}/Content/${folderName}`
  const entries = await listFolder(path)
  return entries.filter(e => e['.tag'] === 'file')
}

// Get asset folders for a client/year
export async function getAssetFolders(clientName, year) {
  const path = `${BASE_PATH}/${year}/${clientName}/Assets`
  const entries = await listFolder(path)
  return entries.filter(e => e['.tag'] === 'folder')
}

// Get files inside an asset folder
export async function getAssetFiles(clientName, year, folderName) {
  const path = `${BASE_PATH}/${year}/${clientName}/Assets/${folderName}`
  const entries = await listFolder(path)
  return entries.filter(e => e['.tag'] === 'file')
}

// Get a temporary download link for a file
export async function getDownloadLink(path) {
  try {
    const data = await dbxFetch('files/get_temporary_link', { path })
    return data.link
  } catch (err) {
    console.error('getDownloadLink error:', err)
    return null
  }
}

// Get a temporary link for preview (images/videos)
export async function getPreviewLink(path) {
  try {
    const data = await dbxFetch('files/get_temporary_link', { path })
    return data.link
  } catch (err) {
    console.error('getPreviewLink error:', err)
    return null
  }
}

// Upload a file to Dropbox
export async function uploadFile(path, fileData) {
  try {
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Dropbox-API-Arg': JSON.stringify({
          path,
          mode: 'add',
          autorename: true,
          mute: false
        }),
        'Content-Type': 'application/octet-stream',
      },
      body: fileData
    })
    if (!res.ok) throw new Error(`Upload error: ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('uploadFile error:', err)
    return null
  }
}

// Delete a file
export async function deleteFile(path) {
  try {
    await dbxFetch('files/delete_v2', { path })
    return true
  } catch (err) {
    console.error('deleteFile error:', err)
    return false
  }
}

// Create a folder
export async function createFolder(path) {
  try {
    await dbxFetch('files/create_folder_v2', { path, autorename: false })
    return true
  } catch (err) {
    console.error('createFolder error:', err)
    return false
  }
}

// Delete a folder
export async function deleteFolder(path) {
  try {
    await dbxFetch('files/delete_v2', { path })
    return true
  } catch (err) {
    console.error('deleteFolder error:', err)
    return false
  }
}

// Get file type from name
export function getFileType(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['mp4','mov','avi','webm','m4v'].includes(ext)) return 'video'
  if (['jpg','jpeg','png','gif','webp','heic'].includes(ext)) return 'photo'
  if (['pdf'].includes(ext)) return 'pdf'
  if (['zip','rar'].includes(ext)) return 'zip'
  return 'other'
}

// Format file size
export function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Format date
export function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
