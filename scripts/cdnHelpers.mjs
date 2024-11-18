import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

dotenv.config();

// Initialize with anon key for public operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY  // Using anon key
);

/**
 * Upload screenshot to existing Supabase Storage bucket
 * @param {Buffer} buffer - Screenshot buffer
 * @param {string} cdnPath - Path like 'screenshots/pinboard/abc123.png'
 * @returns {Promise<string>} - Public URL
 */
export async function uploadToCDN(buffer, cdnPath) {
  try {
    // Create a new client with service role key for this operation
    const adminSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY, // Need to add this to .env
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    console.log(`Uploading to: scrap_screenshots/${cdnPath}`);

    const { data, error } = await adminSupabase.storage
      .from('scrap_screenshots')
      .upload(cdnPath, buffer, {
        contentType: 'image/png',
        upsert: true
      });

    if (error) {
      console.error('Screenshot upload failed:', error);
      return null;
    }

    // Use public client for getting URL
    const { data: { publicUrl } } = supabase.storage
      .from('scrap_screenshots')
      .getPublicUrl(cdnPath);

    return publicUrl;

  } catch (error) {
    console.error('Error uploading screenshot:', error);
    return null;
  }
} 