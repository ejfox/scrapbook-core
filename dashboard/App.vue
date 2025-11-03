<template>
  <div id="app" class="h-screen w-screen flex flex-col bg-white dark:bg-black text-black dark:text-white font-mono transition-colors duration-300">
    <!-- Live activity ticker -->
    <div class="h-6 overflow-hidden bg-black dark:bg-white text-white dark:text-black text-xs leading-6 flex items-center border-b border-gray-700 dark:border-gray-300">
      <div class="ticker-content whitespace-nowrap">
        <template v-if="activityFeed.length > 0">
          <!-- Duplicate content for seamless loop -->
          <template v-for="n in 2" :key="`loop-${n}`">
            <span v-for="(activity, i) in activityFeed" :key="`${n}-${i}`" class="inline-block" style="padding: 0 12vw;">
              {{ activity }}
            </span>
          </template>
        </template>
        <template v-else>
          <!-- Duplicate placeholder content for seamless loop -->
          <template v-for="n in 2" :key="`placeholder-${n}`">
            <span class="inline-block opacity-70" style="padding: 0 12vw;">WAITING FOR ACTIVITY</span>
            <span class="inline-block opacity-50" style="padding: 0 12vw;">• NO UPDATES YET</span>
            <span class="inline-block opacity-50" style="padding: 0 12vw;">• MONITORING REALTIME FEED</span>
            <span class="inline-block opacity-50" style="padding: 0 12vw;">• READY FOR DATA</span>
          </template>
        </template>
      </div>
    </div>

    <!-- Minimal header -->
    <header class="flex-shrink-0 px-4 py-4 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <h1 class="text-base uppercase tracking-widest">SCRAP MONITOR</h1>
        <div v-if="isConnected" class="flex items-center gap-3 text-base">
          <div class="w-4 h-4 rounded-full animate-pulse" style="background-color: #10b981; box-shadow: 0 0 12px #10b981, 0 0 4px #10b981 inset;"></div>
          <span>LIVE</span>
        </div>
        <div v-else class="flex items-center gap-3 text-base opacity-50">
          <div class="w-4 h-4 rounded-full" style="background-color: #ef4444; box-shadow: 0 0 8px #ef4444;"></div>
          <span>OFFLINE</span>
        </div>
      </div>

      <div class="flex items-center gap-4 text-base">
        <!-- Navigation -->
        <div v-if="scraps.length > 0" class="flex items-center gap-2">
          <button
            @click="prevScrap"
            :disabled="currentIndex === 0"
            class="px-3 py-1 disabled:cursor-not-allowed hover:underline"
          >
            ←
          </button>
          <span>{{ currentIndex + 1 }} / {{ scraps.length }}</span>
          <button
            @click="nextScrap"
            :disabled="currentIndex === scraps.length - 1"
            class="px-3 py-1 disabled:cursor-not-allowed hover:underline"
          >
            →
          </button>
        </div>

        <!-- Stats -->
        <div v-if="stats.insertsReceived > 0">
          INS: {{ stats.insertsReceived }} | UPD: {{ stats.updatesReceived }}
        </div>
      </div>
    </header>

    <!-- Full-page scrap display -->
    <main class="flex-1 overflow-hidden">
      <CurrentScrap
        :scrap="currentScrap"
        :isPulsing="currentScrap && recentlyUpdated.has(currentScrap.id)"
      />
    </main>
  </div>
</template>

<style>
.ticker-content {
  animation: scroll-left 120s linear infinite;
}

@keyframes scroll-left {
  0% {
    transform: translateX(100%);
  }
  100% {
    transform: translateX(-100%);
  }
}
</style>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import CurrentScrap from './components/CurrentScrap.vue'
import { useRealtimeScraps } from './composables/useRealtimeScraps'
import { createClient } from '@supabase/supabase-js'

// Scraps list and current index
const scraps = ref([])
const currentIndex = ref(0)
const currentScrap = computed(() => scraps.value[currentIndex.value] || null)

// Activity feed for ticker
const activityFeed = ref([])
const addActivity = (message) => {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })
  activityFeed.value.unshift(`[${timestamp}] ${message}`)
  // Keep only last 50 activities
  if (activityFeed.value.length > 50) {
    activityFeed.value = activityFeed.value.slice(0, 50)
  }
}

// Recently updated scraps for pulse effect
const recentlyUpdated = ref(new Set())
const markAsUpdated = (id) => {
  recentlyUpdated.value.add(id)
  setTimeout(() => {
    recentlyUpdated.value.delete(id)
  }, 3000) // Pulse for 3 seconds
}

// Navigation
const nextScrap = () => {
  if (currentIndex.value < scraps.value.length - 1) {
    currentIndex.value++
  }
}

const prevScrap = () => {
  if (currentIndex.value > 0) {
    currentIndex.value--
  }
}

// Initialize realtime connection
const { isConnected, error, stats } = useRealtimeScraps({
  enableBatching: false,
  onInsert: (newScraps) => {
    // Add new scraps to the beginning of the list
    scraps.value = [...newScraps, ...scraps.value]
    const scrap = newScraps[0]
    console.log('[Dashboard] New scrap inserted:', scrap.id)

    // Add to activity feed
    const title = scrap.title || scrap.url?.substring(0, 40) || 'Untitled'
    addActivity(`🆕 NEW: ${title}`)

    // Auto-advance to new scrap
    currentIndex.value = 0
    markAsUpdated(scrap.id)
  },
  onUpdate: (updates) => {
    // Update scraps in the list
    updates.forEach(({ new: updated }) => {
      const index = scraps.value.findIndex(s => s.id === updated.id)
      if (index !== -1) {
        scraps.value[index] = updated
        console.log('[Dashboard] Scrap updated:', updated.id)

        // Add to activity feed
        const title = updated.title || updated.url?.substring(0, 40) || 'Untitled'
        addActivity(`✓ UPD: ${title}`)

        // Auto-advance to updated scrap
        currentIndex.value = index
        markAsUpdated(updated.id)
      }
    })
  },
  onError: (err) => {
    console.error('[Dashboard] Realtime error:', err)
  }
})

// Keyboard navigation
const handleKeydown = (e) => {
  if (e.key === 'ArrowRight') {
    nextScrap()
  } else if (e.key === 'ArrowLeft') {
    prevScrap()
  }
}

// Fetch recent scraps on mount
onMounted(async () => {
  // Add keyboard listener
  window.addEventListener('keydown', handleKeydown)

  try {
    const supabase = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_KEY
    )

    const { data, error: fetchError } = await supabase
      .from('scraps')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (fetchError) {
      console.error('[Dashboard] Error fetching scraps:', fetchError)
      return
    }

    if (data) {
      scraps.value = data
      console.log('[Dashboard] Loaded', data.length, 'scraps')
    }
  } catch (err) {
    console.error('[Dashboard] Failed to fetch scraps:', err)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

