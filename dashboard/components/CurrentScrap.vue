<template>
  <div class="h-full w-full overflow-y-auto bg-white dark:bg-black text-black dark:text-white font-mono transition-colors duration-300">
    <!-- No scrap state -->
    <div v-if="!currentScrap" class="flex items-center justify-center h-full">
      <div class="text-center space-y-4">
        <div class="text-2xl tracking-widest uppercase">WAITING FOR DATA...</div>
      </div>
    </div>

    <!-- Scrap display - Simple academic grid -->
    <div v-else class="w-full h-full">
      <!-- Clean uniform grid -->
      <div class="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-0">

        <!-- Each field follows the exact same pattern -->
        <div v-for="field in fields" :key="field.name"
             class="p-4 bg-white dark:bg-black transition-all duration-200 flex flex-col min-h-[140px] overflow-hidden"
             :class="{
               'animate-pulse': isProcessing(field.name),
               'col-span-3': field.name === 'relationships',
               'opacity-20': !getValue(field.name)
             }">
          <div class="text-sm uppercase tracking-wider mb-2 flex-shrink-0 leading-tight font-bold">
            {{ field.label }}
          </div>
          <div class="text-base leading-relaxed flex-1 overflow-auto"
               :class="{
                 'font-mono': field.mono,
                 'max-h-[400px]': ['summary', 'content'].includes(field.name)
               }">
            <component :is="renderField(field)" />
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, h } from 'vue'

const props = defineProps({
  scrap: {
    type: Object,
    default: null
  }
})

const currentScrap = ref(null)
const processingFields = ref(new Set())
const expandedRelationships = ref(false)

// Define all fields in display order
const fields = [
  { name: 'id', label: 'ID', mono: true },
  { name: 'scrap_id', label: 'SCRAP_ID', mono: true },
  { name: 'source', label: 'SOURCE' },
  { name: 'type', label: 'TYPE' },
  { name: 'url', label: 'URL', link: true },
  { name: 'title', label: 'TITLE' },
  { name: 'content', label: 'CONTENT' },
  { name: 'summary', label: 'SUMMARY' },
  { name: 'tags', label: 'TAGS', array: true },
  { name: 'concept_tags', label: 'CONCEPTS', array: true },
  { name: 'relationships', label: 'RELATIONS', complex: true },
  { name: 'location', label: 'LOCATION' },
  { name: 'latitude', label: 'LAT', mono: true },
  { name: 'longitude', label: 'LNG', mono: true },
  { name: 'financial_analysis', label: 'FINANCE', json: true },
  { name: 'screenshot_url', label: 'SCREENSHOT', image: true },
  { name: 'content_type', label: 'TYPE' },
  { name: 'extraction_confidence', label: 'CONFIDENCE', mono: true },
  { name: 'shared', label: 'SHARED', boolean: true },
  { name: 'graph_imported', label: 'GRAPHED', boolean: true },
  { name: 'processing_instance_id', label: 'PROC_ID', mono: true },
  { name: 'processing_started_at', label: 'PROC_START', date: true },
  { name: 'created_at', label: 'CREATED', date: true },
  { name: 'updated_at', label: 'UPDATED', date: true },
  { name: 'published_at', label: 'PUBLISHED', date: true },
  { name: 'metadata', label: 'METADATA', json: true },
  { name: 'embedding', label: 'EMBED', mono: true, truncate: 50 },
  { name: 'embedding_nomic', label: 'EMBED_NOM', mono: true, truncate: 50 },
  { name: 'image_embedding', label: 'IMG_EMBED', mono: true, truncate: 50 },
]

const getValue = (fieldName) => {
  const value = currentScrap.value?.[fieldName]
  if (Array.isArray(value)) return value.length > 0
  return !!value
}

const renderField = (field) => {
  const value = currentScrap.value?.[field.name]

  if (!value && !Array.isArray(value)) {
    return () => h('span', '—')
  }

  // Boolean
  if (field.boolean) {
    return () => h('span', value ? 'YES' : 'NO')
  }

  // Date
  if (field.date) {
    const date = new Date(value)
    return () => h('span', date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }))
  }

  // Link
  if (field.link && value) {
    return () => h('a', {
      href: value,
      target: '_blank',
      class: 'hover:underline break-all'
    }, value)
  }

  // Image
  if (field.image && value) {
    return () => h('div', { class: 'max-h-[400px] overflow-y-auto' }, [
      h('img', {
        src: value,
        class: 'w-full h-auto',
        loading: 'lazy'
      })
    ])
  }

  // Array (tags)
  if (field.array && Array.isArray(value) && value.length) {
    return () => h('div', { class: 'flex flex-wrap gap-1' },
      value.map(item =>
        h('span', { class: 'text-sm' }, item + ',')
      )
    )
  }

  // Financial Analysis (special JSON handling)
  if (field.name === 'financial_analysis' && typeof value === 'object') {
    return () => h('div', { class: 'space-y-2 text-sm' }, [
      value.tracked_assets?.map(asset =>
        h('div', { class: 'space-y-1' }, [
          h('div', { class: 'font-bold' }, `${asset.ticker}: ${asset.name}`),
          h('div', `Sentiment: ${asset.sentiment_score}`),
          h('div', asset.sentiment_reasoning),
        ])
      ),
      value.market_reasoning ? h('div', { class: 'mt-2' }, value.market_reasoning) : null
    ])
  }

  // Extraction Confidence (special object handling)
  if (field.name === 'extraction_confidence' && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, val]) =>
      h('div', `${key}: ${val}`)
    )
    return () => h('div', { class: 'space-y-1 text-sm' }, entries)
  }

  // Location (decode complex location data)
  if (field.name === 'location' && typeof value === 'object') {
    const entries = []

    if (value.location) {
      entries.push(h('div', { class: 'font-bold' }, value.location))
      if (value.latitude && value.longitude) {
        entries.push(h('div', { class: 'text-xs' }, `${value.latitude.toFixed(4)}, ${value.longitude.toFixed(4)}`))
      }
    }

    if (value.metadata?.otherLocations?.length > 0) {
      entries.push(h('div', { class: 'mt-2 text-xs' }, 'Other locations:'))
      value.metadata.otherLocations.forEach(loc => {
        entries.push(h('div', { class: 'text-xs' }, loc.location))
      })
    }

    return () => h('div', { class: 'space-y-1 text-sm' }, entries)
  }

  // Metadata (decode and display key fields)
  if (field.name === 'metadata' && typeof value === 'object') {
    const entries = []

    // For arena blocks
    if (value.class) entries.push(h('div', `Class: ${value.class}`))
    if (value.channel) entries.push(h('div', `Channel: ${value.channel}`))
    if (value.connected_to_channels?.length) {
      entries.push(h('div', `Channels: ${value.connected_to_channels.map(c => c.title).join(', ')}`))
    }

    // For pinboard
    if (value.shared !== undefined) entries.push(h('div', `Shared: ${value.shared ? 'Yes' : 'No'}`))
    if (value.toread !== undefined) entries.push(h('div', `To Read: ${value.toread ? 'Yes' : 'No'}`))
    if (value.processed_at) entries.push(h('div', `Processed: ${new Date(value.processed_at).toLocaleString()}`))
    if (value.tags_synced_at) entries.push(h('div', `Tags Synced: ${new Date(value.tags_synced_at).toLocaleString()}`))

    // Fallback to raw if no specific fields
    if (entries.length === 0) {
      const jsonStr = JSON.stringify(value, null, 2)
      return () => h('pre', { class: 'text-sm whitespace-pre-wrap' }, jsonStr)
    }

    return () => h('div', { class: 'space-y-1 text-sm' }, entries)
  }

  // JSON (no truncation, let container scroll)
  if (field.json && typeof value === 'object') {
    const jsonStr = JSON.stringify(value, null, 2)
    return () => h('pre', { class: 'text-sm whitespace-pre-wrap' }, jsonStr)
  }

  // Complex (relationships) - 3 column grid with arrows
  if (field.complex && Array.isArray(value) && value.length) {
    // Filter out empty/invalid relationships
    const validRels = value.filter(rel => rel && typeof rel === 'object' && !Array.isArray(rel) && (rel.source || rel.target))

    if (validRels.length === 0) {
      return () => h('span', '—')
    }

    const limit = 16
    const toShow = expandedRelationships.value ? validRels : validRels.slice(0, limit)
    const hasMore = validRels.length > limit

    return () => h('div', { class: 'space-y-1 text-sm' },
      toShow.map(rel =>
        h('div', { class: 'grid grid-cols-[1fr_auto_1fr] gap-2 items-center' }, [
          h('div', { class: 'text-right' }, rel.source || '?'),
          h('div', { class: 'text-center text-xs whitespace-nowrap' }, `→[${rel.relationship || ''}]→`),
          h('div', rel.target || '?')
        ])
      ).concat(
        hasMore && !expandedRelationships.value ?
          [h('div', {
            class: 'mt-2 text-center cursor-pointer hover:underline',
            onClick: () => { expandedRelationships.value = true }
          }, `+${validRels.length - limit} more`)] : []
      )
    )
  }

  // String (truncate only embeddings, everything else shows full)
  if (typeof value === 'string') {
    const display = field.truncate && value.length > field.truncate
      ? value.substring(0, field.truncate) + '...'
      : value
    return () => h('span', { class: 'break-words' }, display)
  }

  // Default
  return () => h('span', String(value))
}

// Watch for scrap changes
watch(() => props.scrap, (newScrap, oldScrap) => {
  if (!newScrap) {
    currentScrap.value = null
    return
  }

  if (!oldScrap || oldScrap.id !== newScrap.id) {
    currentScrap.value = { ...newScrap }
    processingFields.value.clear()
    expandedRelationships.value = false
    return
  }

  const aiFields = ['summary', 'tags', 'concept_tags', 'relationships', 'location', 'financial_analysis', 'screenshot_url', 'extraction_confidence']

  aiFields.forEach(field => {
    const oldValue = oldScrap?.[field]
    const newValue = newScrap?.[field]

    if (!oldValue && newValue) {
      processingFields.value.delete(field)
    } else if (!oldValue && !newValue) {
      processingFields.value.add(field)
    }
  })

  currentScrap.value = { ...newScrap }
}, { immediate: true, deep: true })

const isProcessing = (field) => {
  return processingFields.value.has(field)
}
</script>

<style scoped>
/* Custom scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: black;
}

:global(.dark) ::-webkit-scrollbar-thumb {
  background: white;
}
</style>
