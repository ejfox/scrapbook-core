import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/**
 * Upload screenshot to existing Supabase Storage bucket
 * @param {Buffer} buffer - Screenshot buffer
 * @param {string} cdnPath - Path like 'screenshots/pinboard/abc123.png'
 * @returns {Promise<string>} - Public URL
 */
export async function uploadToCDN(buffer, cdnPath) {
  try {
    // Upload to existing scrap_screenshots bucket
    const { data, error } = await supabase.storage
      .from('scrap_screenshots')
      .upload(cdnPath, buffer, {
        contentType: 'image/png',
        upsert: true,
        cacheControl: '3600',
        duplex: 'half'
      });

    if (error) {
      console.error('Screenshot upload failed:', error);
      return null;
    }

    // Get public URL from existing bucket
    const { data: { publicUrl } } = supabase.storage
      .from('scrap_screenshots')
      .getPublicUrl(cdnPath);

    return publicUrl;

  } catch (error) {
    console.error('Error uploading screenshot:', error);
    return null;
  }
} 