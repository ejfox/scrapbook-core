/**
 * YouTube Transcript Extraction
 * Fetches transcripts/captions from YouTube videos for better summarization
 */

import { YoutubeTranscript } from '@danielxceron/youtube-transcript'

/**
 * Extract video ID from various YouTube URL formats
 */
export function extractYoutubeVideoId(url) {
  if (!url) return null

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // Just the ID
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  return null
}

/**
 * Check if URL is a YouTube video
 */
export function isYoutubeUrl(url) {
  if (!url) return false
  return url.includes('youtube.com') || url.includes('youtu.be')
}

/**
 * Fetch transcript for a YouTube video
 * Returns the full transcript text or null if unavailable
 * Tries English first, then falls back to any available language
 */
export async function fetchYoutubeTranscript(url) {
  const videoId = extractYoutubeVideoId(url)

  if (!videoId) {
    console.log('Could not extract YouTube video ID from:', url)
    return null
  }

  try {
    console.log(`📺 Fetching YouTube transcript for video: ${videoId}`)

    let transcriptItems = null

    // Try English first
    try {
      transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' })
    } catch (e) {
      // English not available, try without language preference
      transcriptItems = await YoutubeTranscript.fetchTranscript(videoId)
    }

    if (!transcriptItems || transcriptItems.length === 0) {
      console.log('No transcript available for this video')
      return null
    }

    // Combine all transcript segments into full text
    const fullTranscript = transcriptItems
      .map(item => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    const lang = transcriptItems[0]?.lang || 'unknown'
    console.log(`✅ Fetched transcript (${fullTranscript.length} chars, ${transcriptItems.length} segments, lang: ${lang})`)

    return fullTranscript
  } catch (error) {
    // Common errors: no captions available, video private/unavailable
    if (error.message?.includes('Transcript is disabled') ||
        error.message?.includes('No transcript')) {
      console.log('Transcript not available for this video (disabled or not generated)')
    } else {
      console.error('Error fetching YouTube transcript:', error.message)
    }
    return null
  }
}

/**
 * Fetch transcript with metadata
 */
export async function fetchYoutubeTranscriptWithMeta(url) {
  const videoId = extractYoutubeVideoId(url)

  if (!videoId) {
    return { transcript: null, videoId: null, error: 'Invalid YouTube URL' }
  }

  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId)

    if (!transcriptItems || transcriptItems.length === 0) {
      return { transcript: null, videoId, error: 'No transcript available' }
    }

    const fullTranscript = transcriptItems
      .map(item => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    return {
      transcript: fullTranscript,
      videoId,
      segmentCount: transcriptItems.length,
      duration: transcriptItems[transcriptItems.length - 1]?.offset || 0,
      error: null,
    }
  } catch (error) {
    return {
      transcript: null,
      videoId,
      error: error.message,
    }
  }
}

// CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const testUrl = process.argv[2] || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  console.log('Testing YouTube transcript fetch for:', testUrl)

  fetchYoutubeTranscriptWithMeta(testUrl)
    .then(result => {
      if (result.transcript) {
        console.log('\n📝 Transcript preview:')
        console.log(result.transcript.slice(0, 500) + '...')
        console.log(`\nTotal length: ${result.transcript.length} chars`)
        console.log(`Segments: ${result.segmentCount}`)
      } else {
        console.log('Failed:', result.error)
      }
    })
    .catch(console.error)
}
