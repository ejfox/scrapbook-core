/**
 * useRealtimeScraps - A Vue composable for real-time scrap updates
 *
 * Like watching a pot come to boil - we observe each bubble (event)
 * as it rises to the surface, batching them to prevent overwhelming
 * the UI while maintaining sacred awareness of every change.
 *
 * Channels Ada Lovelace's vision: elegant patterns for computational observation
 */

import { ref, computed, onMounted, onUnmounted } from "vue";
import { createClient } from "@supabase/supabase-js";

// Configuration - adjust these sacred ratios like seasoning to taste
const BATCH_DELAY_MS = 300; // Time to let events accumulate like flavors marrying
const MAX_BATCH_SIZE = 50; // Maximum events to process at once
const RECONNECT_DELAY_MS = 1000; // Initial reconnection delay
const MAX_RECONNECT_DELAY_MS = 30000; // Maximum backoff
const RECONNECT_MULTIPLIER = 1.5; // Exponential backoff factor

export function useRealtimeScraps(options = {}) {
  // Destructure options with defaults
  const {
    supabaseUrl = import.meta.env.VITE_SUPABASE_URL,
    supabaseKey = import.meta.env.VITE_SUPABASE_KEY,
    tableName = "scraps",
    enableBatching = true,
    onInsert = null,
    onUpdate = null,
    onError = null,
    autoConnect = true,
  } = options;

  // State - our mise en place
  const supabase = ref(null);
  const channel = ref(null);
  const isConnected = ref(false);
  const isReconnecting = ref(false);
  const error = ref(null);
  const eventQueue = ref([]);
  const stats = ref({
    insertsReceived: 0,
    updatesReceived: 0,
    errorsEncountered: 0,
    lastEventAt: null,
    connectionAttempts: 0,
  });

  let batchTimer = null;
  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_DELAY_MS;

  /**
   * Initialize the Supabase client
   * Like preparing your workspace before cooking
   */
  const initializeClient = () => {
    if (!supabaseUrl || !supabaseKey) {
      const msg = "Missing Supabase credentials - check your .env file";
      error.value = new Error(msg);
      console.error("[Realtime] ", msg);
      return false;
    }

    try {
      supabase.value = createClient(supabaseUrl, supabaseKey, {
        realtime: {
          params: {
            eventsPerSecond: 10, // Rate limiting - prevent overwhelming the system
          },
        },
      });
      return true;
    } catch (err) {
      error.value = err;
      console.error("[Realtime] Failed to initialize Supabase client:", err);
      return false;
    }
  };

  /**
   * Process the event queue in batches
   * Like plating multiple dishes at once - efficient and elegant
   */
  const processBatch = () => {
    if (eventQueue.value.length === 0) return;

    const batch = eventQueue.value.splice(0, MAX_BATCH_SIZE);

    // Group events by type for efficient processing
    const inserts = batch.filter(e => e.eventType === "INSERT");
    const updates = batch.filter(e => e.eventType === "UPDATE");

    // Call callbacks with batched events
    if (inserts.length > 0 && onInsert) {
      onInsert(inserts.map(e => e.new));
    }

    if (updates.length > 0 && onUpdate) {
      onUpdate(updates.map(e => ({ old: e.old, new: e.new })));
    }

    // If queue still has events, schedule another batch
    if (eventQueue.value.length > 0) {
      batchTimer = setTimeout(processBatch, BATCH_DELAY_MS);
    }
  };

  /**
   * Queue an event for batch processing
   * Or process immediately if batching is disabled
   */
  const queueEvent = (payload, eventType) => {
    stats.value.lastEventAt = new Date();

    if (eventType === "INSERT") {
      stats.value.insertsReceived++;
    } else if (eventType === "UPDATE") {
      stats.value.updatesReceived++;
    }

    if (!enableBatching) {
      // Process immediately
      if (eventType === "INSERT" && onInsert) {
        onInsert([payload.new]);
      } else if (eventType === "UPDATE" && onUpdate) {
        onUpdate([{ old: payload.old, new: payload.new }]);
      }
      return;
    }

    // Add to queue
    eventQueue.value.push({
      eventType,
      ...payload,
      queuedAt: new Date(),
    });

    // Clear existing timer and schedule new batch
    if (batchTimer) {
      clearTimeout(batchTimer);
    }
    batchTimer = setTimeout(processBatch, BATCH_DELAY_MS);
  };

  /**
   * Handle connection errors with exponential backoff
   * Like letting dough rest - sometimes you need to wait before trying again
   */
  const handleError = (err) => {
    stats.value.errorsEncountered++;
    error.value = err;
    console.error("[Realtime] Connection error:", err);

    if (onError) {
      onError(err);
    }

    // Attempt reconnection with exponential backoff
    attemptReconnect();
  };

  /**
   * Attempt to reconnect with exponential backoff
   * Wisdom from Ada: graceful degradation and recovery
   */
  const attemptReconnect = () => {
    if (isReconnecting.value) return;

    isReconnecting.value = true;
    stats.value.connectionAttempts++;

    console.log(`[Realtime] Attempting reconnect in ${reconnectDelay}ms...`);

    reconnectTimer = setTimeout(() => {
      disconnect();

      if (connect()) {
        // Reset delay on successful connection
        reconnectDelay = RECONNECT_DELAY_MS;
        isReconnecting.value = false;
      } else {
        // Exponential backoff
        reconnectDelay = Math.min(
          reconnectDelay * RECONNECT_MULTIPLIER,
          MAX_RECONNECT_DELAY_MS,
        );
        isReconnecting.value = false;
        attemptReconnect();
      }
    }, reconnectDelay);
  };

  /**
   * Subscribe to real-time changes
   * The main ritual - opening the channel to observe events
   */
  const connect = () => {
    if (!supabase.value && !initializeClient()) {
      return false;
    }

    if (channel.value) {
      console.warn("[Realtime] Already connected");
      return true;
    }

    try {
      // Create channel subscription
      channel.value = supabase.value
        .channel(`${tableName}_changes`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: tableName,
          },
          (payload) => {
            console.log("[Realtime] INSERT event:", payload);
            queueEvent(payload, "INSERT");
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: tableName,
          },
          (payload) => {
            console.log("[Realtime] UPDATE event:", payload);
            queueEvent(payload, "UPDATE");
          },
        )
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            isConnected.value = true;
            error.value = null;
            console.log("[Realtime] Successfully subscribed to", tableName);
          } else if (status === "CHANNEL_ERROR") {
            isConnected.value = false;
            handleError(err || new Error("Channel subscription error"));
          } else if (status === "TIMED_OUT") {
            isConnected.value = false;
            handleError(new Error("Subscription timed out"));
          } else if (status === "CLOSED") {
            isConnected.value = false;
          }
        });

      return true;
    } catch (err) {
      handleError(err);
      return false;
    }
  };

  /**
   * Unsubscribe from real-time changes
   * Cleanup - always leave your kitchen cleaner than you found it
   */
  const disconnect = () => {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (channel.value) {
      supabase.value.removeChannel(channel.value);
      channel.value = null;
    }

    isConnected.value = false;
  };

  /**
   * Force process any pending events
   * Emergency plating - serve what's ready now
   */
  const flush = () => {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    processBatch();
  };

  /**
   * Clear error state
   */
  const clearError = () => {
    error.value = null;
  };

  // Computed properties for convenient access
  const hasError = computed(() => error.value !== null);
  const queueSize = computed(() => eventQueue.value.length);

  // Lifecycle hooks
  onMounted(() => {
    if (autoConnect) {
      connect();
    }
  });

  onUnmounted(() => {
    disconnect();
  });

  // Return the API - the tools for your cooking
  return {
    // State
    isConnected,
    isReconnecting,
    error,
    hasError,
    stats,
    queueSize,

    // Methods
    connect,
    disconnect,
    flush,
    clearError,

    // Direct Supabase access for advanced rituals
    client: computed(() => supabase.value),
  };
}
