<template>
  <div class="scraps-feed">
    <!-- Connection Status Indicator -->
    <div class="status-bar" :class="statusClass">
      <div class="status-indicator">
        <span class="status-dot" :class="{ 'pulse': isReconnecting }" />
        <span class="status-text">
          {{ statusText }}
        </span>
      </div>

      <div v-if="isConnected" class="stats">
        <span class="stat">
          {{ stats.insertsReceived }} new
        </span>
        <span class="stat">
          {{ stats.updatesReceived }} updated
        </span>
        <span v-if="queueSize > 0" class="stat">
          {{ queueSize }} queued
        </span>
      </div>

      <button
        v-if="hasError"
        class="btn-dismiss"
        aria-label="Dismiss error"
        @click="clearError"
      >
        ×
      </button>
    </div>

    <!-- Recent Activity Feed -->
    <div class="activity-feed">
      <TransitionGroup name="scrap-item" tag="div">
        <div
          v-for="scrap in recentScraps"
          :key="scrap.id"
          class="scrap-item"
          :class="`source-${scrap.source}`"
        >
          <div class="scrap-header">
            <span class="source-tag">{{ scrap.source }}</span>
            <span class="timestamp">{{ formatTime(scrap.created_at) }}</span>
          </div>

          <div class="scrap-content">
            <h3 v-if="scrap.title" class="scrap-title">
              {{ scrap.title }}
            </h3>
            <p v-if="scrap.ai_summary" class="scrap-summary">
              {{ scrap.ai_summary }}
            </p>
          </div>

          <div v-if="scrap.ai_tags?.length" class="scrap-tags">
            <span
              v-for="tag in scrap.ai_tags.slice(0, 5)"
              :key="tag"
              class="tag"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </TransitionGroup>

      <div v-if="recentScraps.length === 0" class="empty-state">
        <p>Waiting for scraps to flow in...</p>
        <p class="hint">
          The stream is quiet. New items will appear here in real-time.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useRealtimeScraps } from "../composables/useRealtimeScraps";

// Maximum scraps to show in the feed
const MAX_FEED_SIZE = 50;

// State
const recentScraps = ref([]);

// Initialize realtime subscription
const {
  isConnected,
  isReconnecting,
  error,
  hasError,
  stats,
  queueSize,
  clearError,
} = useRealtimeScraps({
  enableBatching: true,

  // Handle new scraps
  onInsert: (scraps) => {
    console.log(`[Feed] Received ${scraps.length} new scraps`);

    // Add to beginning of feed
    recentScraps.value = [
      ...scraps,
      ...recentScraps.value,
    ].slice(0, MAX_FEED_SIZE);
  },

  // Handle updated scraps
  onUpdate: (updates) => {
    console.log(`[Feed] Received ${updates.length} scrap updates`);

    updates.forEach(({ old, new: updated }) => {
      const index = recentScraps.value.findIndex(s => s.id === updated.id);

      if (index !== -1) {
        // Update existing scrap in feed
        recentScraps.value[index] = updated;
      } else {
        // Add to feed if not present (might have been added before we subscribed)
        recentScraps.value = [
          updated,
          ...recentScraps.value,
        ].slice(0, MAX_FEED_SIZE);
      }
    });
  },

  // Handle errors
  onError: (err) => {
    console.error("[Feed] Realtime error:", err);
  },
});

// Computed status
const statusClass = computed(() => {
  if (hasError.value) return "status-error";
  if (isReconnecting.value) return "status-reconnecting";
  if (isConnected.value) return "status-connected";
  return "status-disconnected";
});

const statusText = computed(() => {
  if (hasError.value) return `Error: ${error.value.message}`;
  if (isReconnecting.value) return "Reconnecting...";
  if (isConnected.value) return "Live";
  return "Disconnected";
});

// Format timestamp
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // Less than a minute
  if (diff < 60000) {
    return "just now";
  }

  // Less than an hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }

  // Less than a day
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  // Older - show date
  return date.toLocaleDateString();
};
</script>

<style scoped>
.scraps-feed {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 12px;
  overflow: hidden;
  backdrop-filter: blur(10px);
}

/* Status Bar */
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid rgba(0, 255, 136, 0.1);
  transition: background-color 0.3s ease;
}

.status-connected {
  background: rgba(0, 255, 136, 0.1);
}

.status-reconnecting {
  background: rgba(255, 193, 7, 0.1);
}

.status-error {
  background: rgba(255, 82, 82, 0.1);
}

.status-disconnected {
  background: rgba(128, 128, 128, 0.1);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  transition: all 0.3s ease;
}

.status-connected .status-dot {
  color: #00ff88;
}

.status-reconnecting .status-dot {
  color: #ffc107;
}

.status-error .status-dot {
  color: #ff5252;
}

.status-disconnected .status-dot {
  color: #888;
}

.pulse {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.status-text {
  font-size: 0.9rem;
  font-weight: 500;
  color: #e0e0e0;
}

.stats {
  display: flex;
  gap: 15px;
  font-size: 0.85rem;
  color: #aaa;
}

.stat {
  display: flex;
  align-items: center;
}

.btn-dismiss {
  background: none;
  border: none;
  color: #e0e0e0;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.2s ease;
}

.btn-dismiss:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Activity Feed */
.activity-feed {
  max-height: 600px;
  overflow-y: auto;
  padding: 20px;
}

.scrap-item {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 255, 136, 0.1);
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 15px;
  transition: all 0.3s ease;
}

.scrap-item:hover {
  border-color: #00ff88;
  box-shadow: 0 5px 20px rgba(0, 255, 136, 0.2);
  transform: translateY(-2px);
}

.scrap-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.source-tag {
  background: rgba(0, 255, 136, 0.2);
  color: #00ff88;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  text-transform: uppercase;
  font-weight: 600;
}

.timestamp {
  color: #888;
  font-size: 0.8rem;
}

.scrap-title {
  color: #00ff88;
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.scrap-summary {
  color: #ccc;
  font-size: 0.9rem;
  line-height: 1.4;
  margin: 0;
}

.scrap-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.tag {
  background: rgba(0, 255, 136, 0.1);
  color: #00ff88;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 0.75rem;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #888;
}

.empty-state p {
  margin: 10px 0;
}

.hint {
  font-size: 0.85rem;
  opacity: 0.7;
}

/* Transitions */
.scrap-item-enter-active {
  transition: all 0.5s ease;
}

.scrap-item-leave-active {
  transition: all 0.3s ease;
}

.scrap-item-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}

.scrap-item-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

/* Scrollbar styling */
.activity-feed::-webkit-scrollbar {
  width: 8px;
}

.activity-feed::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.activity-feed::-webkit-scrollbar-thumb {
  background: rgba(0, 255, 136, 0.3);
  border-radius: 4px;
}

.activity-feed::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 255, 136, 0.5);
}
</style>
