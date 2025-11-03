// ⚡ SPEED DEMON'S MINIMAL VUE 3 DASHBOARD ⚡
// No build tools, just PURE REACTIVE SPEED!

const { createApp, ref, reactive, computed, onMounted, onUnmounted } = Vue;

// ScrapCard Component - Where the *swoosh* happens!
const ScrapCard = {
  name: "ScrapCard",
  props: {
    scrap: {
      type: Object,
      required: true,
    },
  },
  emits: ["field-update"],
  setup(props, { emit }) {
    const cardRef = ref(null);

    // Track which fields are updating for animation *zoom*
    const updatingFields = reactive(new Set());

    // Animate field updates with that BUTTERY SMOOTH ease-out-cubic!
    const animateFieldUpdate = (fieldName) => {
      updatingFields.add(fieldName);

      const fieldElement = cardRef.value?.querySelector(`[data-field="${fieldName}"]`);
      if (fieldElement) {
        // *WHOOSH* Highlight animation!
        anime({
          targets: fieldElement,
          backgroundColor: ["#00ff00", "#000000"],
          duration: 800,
          easing: "easeOutCubic",
          complete: () => {
            updatingFields.delete(fieldName);
          },
        });
      }

      emit("field-update", { scrapId: props.scrap.id, fieldName });
    };

    // Format tags nicely
    const formattedTags = computed(() => {
      if (!props.scrap.ai_tags) return [];
      return Array.isArray(props.scrap.ai_tags)
        ? props.scrap.ai_tags
        : props.scrap.ai_tags.split(",").map(t => t.trim());
    });

    // Relationship count for quick stats
    const relationshipCount = computed(() => {
      return props.scrap.relationships?.length || 0;
    });

    // Completeness percentage - how processed is this scrap?
    const completeness = computed(() => {
      const fields = ["ai_summary", "ai_tags", "relationships", "location", "financial_analysis", "screenshot_url"];
      const filled = fields.filter(f => props.scrap[f]).length;
      return Math.round((filled / fields.length) * 100);
    });

    onMounted(() => {
      // Entrance animation *zoom*
      anime({
        targets: cardRef.value,
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 400,
        easing: "easeOutCubic",
      });
    });

    return {
      cardRef,
      updatingFields,
      animateFieldUpdate,
      formattedTags,
      relationshipCount,
      completeness,
    };
  },
  template: `
    <article ref="cardRef" class="scrap-card" :data-source="scrap.source">
      <!-- Card header -->
      <div class="card-header">
        <div class="source-tag">{{ scrap.source }}</div>
        <div class="completeness-bar">
          <div class="completeness-fill" :style="{ width: completeness + '%' }"></div>
          <span class="completeness-text">{{ completeness }}%</span>
        </div>
      </div>

      <!-- Screenshot if available -->
      <div v-if="scrap.screenshot_url" class="screenshot-container" data-field="screenshot_url">
        <img :src="scrap.screenshot_url" :alt="'Screenshot of ' + scrap.title" loading="lazy">
      </div>

      <!-- Main content -->
      <div class="card-body">
        <h3 class="scrap-title" data-field="title">{{ scrap.title || 'UNTITLED' }}</h3>

        <div v-if="scrap.url" class="scrap-url" data-field="url">
          <a :href="scrap.url" target="_blank" rel="noopener">{{ scrap.url }}</a>
        </div>

        <div v-if="scrap.content" class="scrap-content" data-field="content">
          {{ scrap.content.substring(0, 200) }}{{ scrap.content.length > 200 ? '...' : '' }}
        </div>

        <!-- AI Summary - *swoosh* -->
        <div v-if="scrap.ai_summary" class="field-section ai-summary" data-field="ai_summary">
          <div class="field-label">AI_SUMMARY:</div>
          <div class="field-value">{{ scrap.ai_summary }}</div>
        </div>

        <!-- AI Tags -->
        <div v-if="scrap.ai_tags" class="field-section ai-tags" data-field="ai_tags">
          <div class="field-label">TAGS:</div>
          <div class="tags-container">
            <span v-for="tag in formattedTags" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </div>

        <!-- Relationships -->
        <div v-if="scrap.relationships && scrap.relationships.length" class="field-section relationships" data-field="relationships">
          <div class="field-label">RELATIONSHIPS ({{ relationshipCount }}):</div>
          <div class="relationships-list">
            <div v-for="(rel, idx) in scrap.relationships.slice(0, 5)" :key="idx" class="relationship">
              <span class="rel-subject">{{ rel.subject }}</span>
              <span class="rel-predicate">→ {{ rel.predicate }} →</span>
              <span class="rel-object">{{ rel.object }}</span>
            </div>
            <div v-if="scrap.relationships.length > 5" class="more-relationships">
              +{{ scrap.relationships.length - 5 }} more
            </div>
          </div>
        </div>

        <!-- Location -->
        <div v-if="scrap.location" class="field-section location" data-field="location">
          <div class="field-label">LOCATION:</div>
          <div class="field-value">{{ scrap.location }}</div>
        </div>

        <!-- Financial Analysis -->
        <div v-if="scrap.financial_analysis" class="field-section financial" data-field="financial_analysis">
          <div class="field-label">FINANCIAL:</div>
          <div class="field-value">{{ JSON.stringify(scrap.financial_analysis) }}</div>
        </div>
      </div>

      <!-- Card footer with metadata -->
      <div class="card-footer">
        <span class="timestamp">{{ new Date(scrap.timestamp).toLocaleString() }}</span>
        <span class="scrap-id">ID: {{ scrap.id.substring(0, 8) }}</span>
      </div>
    </article>
  `,
};

// Main App - THIS IS WHERE WE GO FULL SPEED! *zoom*
const app = createApp({
  components: {
    ScrapCard,
  },
  setup() {
    // Reactive state - LIGHTNING FAST updates!
    const scraps = ref([]);
    const stats = reactive({
      total: 0,
      processing: 0,
      complete: 0,
    });
    const connectionStatus = ref("connecting");
    const fps = ref(60); // Always aim for 60fps! *pew pew*

    let updateInterval = null;
    let fpsInterval = null;
    let frameCount = 0;

    // Mock data generator for testing - replace with real API/WebSocket
    const generateMockScrap = () => {
      const sources = ["arena", "github", "pinboard", "mastodon"];
      const source = sources[Math.floor(Math.random() * sources.length)];

      return {
        id: `scrap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        source: source,
        title: `Sample Scrap from ${source}`,
        url: `https://example.com/${Math.random().toString(36).substr(2, 9)}`,
        content: `This is sample content that would come from ${source}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. In a real implementation, this would be actual scraped content.`,
        ai_summary: Math.random() > 0.3 ? `AI-generated summary of the content from ${source}` : null,
        ai_tags: Math.random() > 0.3 ? ["technology", "web", source] : null,
        relationships: Math.random() > 0.4 ? [
          { subject: "User", predicate: "posted", object: "Content" },
          { subject: "Content", predicate: "relates_to", object: "Technology" },
        ] : null,
        location: Math.random() > 0.7 ? "New York, NY" : null,
        financial_analysis: Math.random() > 0.9 ? { amount: 100, currency: "USD" } : null,
        screenshot_url: Math.random() > 0.5 ? `https://picsum.photos/400/300?random=${Math.random()}` : null,
        timestamp: new Date().toISOString(),
      };
    };

    // Load initial scraps with STAGGER animation! *whoosh*
    const loadInitialScraps = () => {
      // In production, replace with: fetch('/api/scraps')
      const initialScraps = Array.from({ length: 12 }, () => generateMockScrap());
      scraps.value = initialScraps;

      stats.total = initialScraps.length;
      updateStats();

      // Stagger animation for grid *zoom zoom zoom*
      setTimeout(() => {
        anime({
          targets: ".scrap-card",
          opacity: [0, 1],
          translateY: [40, 0],
          delay: anime.stagger(80), // Each card 80ms apart - SO SMOOTH!
          duration: 600,
          easing: "easeOutCubic",
        });
      }, 100);
    };

    // Update stats based on scrap completeness
    const updateStats = () => {
      let processing = 0;
      let complete = 0;

      scraps.value.forEach(scrap => {
        const fields = ["ai_summary", "ai_tags", "relationships", "location", "financial_analysis"];
        const filled = fields.filter(f => scrap[f]).length;
        const completeness = (filled / fields.length) * 100;

        if (completeness === 100) complete++;
        else if (completeness > 0) processing++;
      });

      stats.processing = processing;
      stats.complete = complete;
    };

    // Simulate realtime updates - replace with WebSocket in production!
    const startRealtimeUpdates = () => {
      updateInterval = setInterval(() => {
        if (scraps.value.length > 0 && Math.random() > 0.7) {
          // Randomly update a scrap's field
          const randomScrap = scraps.value[Math.floor(Math.random() * scraps.value.length)];
          const fields = ["ai_summary", "ai_tags", "relationships", "location"];
          const randomField = fields[Math.floor(Math.random() * fields.length)];

          if (!randomScrap[randomField]) {
            randomScrap[randomField] = `Updated ${randomField} at ${new Date().toLocaleTimeString()}`;
            updateStats();

            // *WHOOSH* Trigger animation!
            frameCount++;
          }
        }

        // Occasionally add new scraps *zoom*
        if (Math.random() > 0.95 && scraps.value.length < 20) {
          const newScrap = generateMockScrap();
          scraps.value.unshift(newScrap);
          stats.total++;
          updateStats();
        }
      }, 2000);

      connectionStatus.value = "connected";
    };

    // FPS counter because we're PERFORMANCE OBSESSED!
    const startFPSCounter = () => {
      let lastTime = performance.now();
      let frames = 0;

      fpsInterval = setInterval(() => {
        const now = performance.now();
        const delta = now - lastTime;
        fps.value = Math.round((frames * 1000) / delta);
        frames = 0;
        lastTime = now;
      }, 1000);

      // Count frames
      const countFrame = () => {
        frames++;
        requestAnimationFrame(countFrame);
      };
      requestAnimationFrame(countFrame);
    };

    // Handle field updates from child components
    const onFieldUpdate = ({ scrapId, fieldName }) => {
      console.log(`⚡ Field updated: ${fieldName} on scrap ${scrapId}`);
      updateStats();
    };

    // Lifecycle hooks
    onMounted(() => {
      console.log("⚡ DASHBOARD INITIALIZING AT LIGHTSPEED!");
      loadInitialScraps();
      startRealtimeUpdates();
      startFPSCounter();

      // *[adjusts lucky hoodie]* Let's make this EPIC!
      anime({
        targets: ".dashboard-header",
        opacity: [0, 1],
        translateY: [-20, 0],
        duration: 800,
        easing: "easeOutCubic",
      });
    });

    onUnmounted(() => {
      if (updateInterval) clearInterval(updateInterval);
      if (fpsInterval) clearInterval(fpsInterval);
    });

    return {
      scraps,
      stats,
      connectionStatus,
      fps,
      onFieldUpdate,
    };
  },
});

// Mount the app and GO GO GO!
app.mount("#app");

console.log("⚡ SCRAPBOOK DASHBOARD RUNNING AT 60FPS! *whoosh*");
