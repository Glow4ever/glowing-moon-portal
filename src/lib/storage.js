import { supabase } from './supabase'

// Get a signed URL for a file (expires in 1 hour)
export async function getSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from('portal-assets')
    .createSignedUrl(path, 3600)
  if (error) return null
  return data.signedUrl
}

// Get signed URLs for multiple files at once
export async function getSignedUrls(paths) {
  const { data, error } = await supabase.storage
    .from('portal-assets')
    .createSignedUrls(paths, 3600)
  if (error) return []
  return data
}

// Upload a file and return its path
export async function uploadFile(bucket, path, file, options = {}) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true, ...options })
  return { error }
}

// Delete a file
export async function deleteFile(bucket, path) {
  const { error } = await supabase.storage
    .from(bucket)
    .remove([path])
  return { error }
}
