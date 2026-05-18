const ACCESS_TOKEN = import.meta.env.VITE_DROPBOX_ACCESS_TOKEN

// Team folder configuration
const TEAM_FOLDER_NAME = 'Commercial'
const PORTAL_PATH = 'Glowing Moon Portal'

// We need to first get the namespace ID for the Commercial team folder
// then use it as path_root for all subsequent calls
let teamNamespaceId = null

async function getTeamNamespaceId() {
  if (teamNamespaceId) return teamNamespaceId
  
  try {
    // List root to find the Commercial team folder namespace
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: '', include_mounted_folders: true, include_non_downloadable_files: true })
    })
    const data = await res.json()
    if (data.entries) {
      const teamFolder = data.entries.find(e => e.name === TEAM_FOLDER_NAME && e.sharing_info)
      if (teamFolder?.sharing_info?.read_only !== undefined) {
        teamNamespaceId = teamFolder.sharing_info?.parent_shared_folder_id || teamFolder.id
      }
    }
  } catch (err) {
    console.error('getTeamNamespaceId error:', err)
  }
  return teamNamespaceId
}

async function dbxFetch(endpoint, body, useTeamNamespace = false) {
  const headers = {
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  }

  if (useTeamNamespace) {
    headers['Dropbox-API-Path-Root'] = JSON.stringify({
      '.tag': 'namespace_id',
      'namespace_id': await getTeamNamespaceId()
    })
  }

  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`Dropbox API error ${res.status}:`, text)
    throw new Error(`Dropbox API error: ${res.status}`)
  }
  return res.json()
}

// List folder contents
async function listFolder(path) {
  try {
    // Try direct path first (works if portal folder is shared with personal account)
    const fullPath = `/${TEAM_FOLDER_NAME}/${PORTAL_PATH}${path ? '/' + path : ''}`
    const data = await dbxFetch('files/list_folder', {
      path: fullPath,
      include_deleted: false
    })
    return data.entries || []
  } catch (err) {
    console.error('listFolder error, trying team namespace:', err)
    try {
      // Try with team_data scope using path from team space root
      const data = await dbxFetch('files/list_folder', {
        path: `/${PORTAL_PATH}${path ? '/' + path : ''}`,
        include_deleted: false
      }, true)
      return data.entries || []
    } catch (err2) {
      console.error('listFolder team namespace error:', err2)
      return []
    }
  }
}

// Get years available
export async function getClientYears(clientName) {
  try {
    const entries = await listFolder('')
    console.log('Year entries:', entries)
    const years = entries
      .filter(e => e['.tag'] === 'folder' && /^\d{4}$/.test(e.name))
      .map(e => e.name)
      .sort((a, b) => b - a)
    return years
  } catch (err) {
    console.error('getClientYears error:', err)
    return []
  }
}

export async function getContentFolders(clientName, year) {
  const entries = await listFolder(`${year}/${clientName}/Content`)
  return entries.filter(e => e['.tag'] === 'folder')
}

export async function getContentFiles(clientName, year, folderName) {
  const entries = await listFolder(`${year}/${clientName}/Content/${folderName}`)
  return entries.filter(e => e['.tag'] === 'file')
}

export async function getAssetFolders(clientName, year) {
  const entries = await listFolder(`${year}/${clientName}/Assets`)
  return entries.filter(e => e['.tag'] === 'folder')
}

export async function getAssetFiles(clientName, year, folderName) {
  const entries = await listFolder(`${year}/${clientName}/Assets/${folderName}`)
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
    const fullPath = `/${TEAM_FOLDER_NAME}/${PORTAL_PATH}/${relativePath}`
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: fullPath,
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
    const fullPath = `/${TEAM_FOLDER_NAME}/${PORTAL_PATH}/${relativePath}`
    await dbxFetch('files/create_folder_v2', { path: fullPath, autorename: false })
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
