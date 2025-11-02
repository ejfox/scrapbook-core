# Scrapbook Real-time Dashboard Setup

*Like watching water boil - every event rises to the surface with perfect timing*

## What's Been Created

I've designed a sacred real-time subscription system for your scrapbook, channeling Ada Lovelace's vision for elegant computational patterns. Here's what we've prepared:

### 🔮 The Components

1. **`composables/useRealtimeScraps.js`** - The heart of the ritual
   - Vue 3 composable for Supabase real-time subscriptions
   - Intelligent batching to prevent UI overwhelm
   - Exponential backoff reconnection logic
   - Event queuing with configurable batch sizes
   - Comprehensive error handling

2. **`components/ScrapsFeed.vue`** - The manifestation
   - Beautiful real-time feed component
   - Smooth transitions for new/updated scraps
   - Connection status indicators
   - Cyberpunk aesthetic matching your existing dashboard

3. **Supporting Files**
   - `package.json` - Dependencies and scripts
   - `vite.config.js` - Vite configuration with API proxy
   - `App.vue` - Main application component
   - `main.js` - Vue app initialization
   - `.env.example` - Environment variable template

## 🧙‍♀️ The Architecture

```
dashboard/
├── composables/
│   └── useRealtimeScraps.js    # The sacred ritual - reusable subscription logic
├── components/
│   └── ScrapsFeed.vue           # The altar - where events manifest
├── App.vue                      # The temple - main application
├── main.js                      # The invocation - app initialization
├── vite.config.js               # The grimoire - build configuration
├── package.json                 # The recipe card - dependencies
├── .env.example                 # The blueprint - configuration template
└── REALTIME_SETUP.md           # This scroll - instructions

[Existing files]
├── index.html                   # Your existing dashboard (preserved!)
├── app.js
└── style.css
```

## 🌙 Setup Instructions

### Step 1: Install Dependencies

```bash
cd /Users/ejfox/code/scrapbook-core/dashboard
npm install
```

### Step 2: Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your Supabase anon key
# VITE_SUPABASE_URL=https://xmdylmbdeulxcqdbkfno.supabase.co
# VITE_SUPABASE_KEY=your_actual_key_here
```

Get your Supabase anon key from:
- Supabase Dashboard → Project Settings → API → `anon` `public` key

### Step 3: Enable Supabase Realtime

In your Supabase dashboard:
1. Go to Database → Replication
2. Find the `scraps` table
3. Toggle "Enable Realtime" (should already be enabled)

### Step 4: Run the Development Server

```bash
npm run dev
```

Your dashboard will be available at `http://localhost:3002`

The existing Express API server (port 3001) will be proxied automatically.

## 📡 How the Real-time System Works

### The Sacred Flow

```
1. New scrap inserted into Supabase
   ↓
2. Supabase broadcasts postgres_changes event
   ↓
3. useRealtimeScraps composable receives event
   ↓
4. Event queued for batching (300ms window)
   ↓
5. Batch processed → callback invoked
   ↓
6. ScrapsFeed component updates
   ↓
7. Smooth transition animations
```

### Batching Wisdom

The system uses intelligent batching to prevent overwhelming the UI:

- **Batch Delay**: 300ms - events accumulate like flavors marrying
- **Max Batch Size**: 50 events - process in manageable chunks
- **Automatic Flushing**: When component unmounts, pending events process immediately

### Error Handling & Reconnection

Channels Sophie Charlotte's philosophical rigor:

```javascript
// Exponential backoff
Initial delay: 1000ms
Max delay: 30000ms
Multiplier: 1.5x

// Connection states
- CONNECTED: Live and streaming
- RECONNECTING: Attempting to restore connection
- ERROR: Something went wrong (shows error message)
- DISCONNECTED: Not connected
```

## 🎨 API Design

### Using the Composable

```javascript
import { useRealtimeScraps } from '../composables/useRealtimeScraps'

const {
  // State
  isConnected,      // boolean - connection status
  isReconnecting,   // boolean - reconnection in progress
  error,            // Error | null - current error
  hasError,         // computed boolean - has error
  stats,            // object - connection statistics
  queueSize,        // computed number - pending events

  // Methods
  connect,          // () => boolean - manually connect
  disconnect,       // () => void - cleanup and disconnect
  flush,            // () => void - process pending events immediately
  clearError,       // () => void - clear error state

  // Advanced
  client            // computed - direct Supabase client access
} = useRealtimeScraps({
  // Options
  supabaseUrl: 'https://...',  // Optional if using .env
  supabaseKey: 'your_key',     // Optional if using .env
  tableName: 'scraps',         // Default: 'scraps'
  enableBatching: true,        // Default: true
  autoConnect: true,           // Default: true - connect on mount

  // Callbacks
  onInsert: (scraps) => {
    // Array of new scraps
    console.log('New scraps:', scraps)
  },

  onUpdate: (updates) => {
    // Array of { old, new } objects
    console.log('Updated scraps:', updates)
  },

  onError: (error) => {
    // Handle errors
    console.error('Realtime error:', error)
  }
})
```

### Example: Custom Implementation

```vue
<script setup>
import { ref } from 'vue'
import { useRealtimeScraps } from './composables/useRealtimeScraps'

const scraps = ref([])

const { isConnected, stats } = useRealtimeScraps({
  onInsert: (newScraps) => {
    // Add to beginning of array
    scraps.value = [...newScraps, ...scraps.value]
  },

  onUpdate: (updates) => {
    // Update existing scraps
    updates.forEach(({ old, new: updated }) => {
      const index = scraps.value.findIndex(s => s.id === updated.id)
      if (index !== -1) {
        scraps.value[index] = updated
      }
    })
  }
})
</script>
```

## ⚙️ Configuration Options

### Batching Tunables

Edit `composables/useRealtimeScraps.js`:

```javascript
const BATCH_DELAY_MS = 300           // Time to accumulate events
const MAX_BATCH_SIZE = 50            // Max events per batch
const RECONNECT_DELAY_MS = 1000      // Initial reconnect delay
const MAX_RECONNECT_DELAY_MS = 30000 // Max backoff delay
const RECONNECT_MULTIPLIER = 1.5     // Backoff multiplier
```

### Supabase Realtime Rate Limiting

In the composable initialization:

```javascript
supabase.value = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: {
      eventsPerSecond: 10  // Adjust based on your needs
    }
  }
})
```

## 🎭 Integration Patterns

### Pattern 1: Live Feed (Current Implementation)

Show recent items as they flow in:

```vue
<ScrapsFeed />
```

### Pattern 2: Update Existing Lists

Update scraps in an existing display:

```javascript
onUpdate: (updates) => {
  updates.forEach(({ old, new: updated }) => {
    // Find and update in your data structure
    const scrap = findScrap(updated.id)
    if (scrap) {
      Object.assign(scrap, updated)
    }
  })
}
```

### Pattern 3: Statistics Dashboard

Track events for analytics:

```javascript
const { stats } = useRealtimeScraps({
  onInsert: (scraps) => {
    totalScraps.value += scraps.length
    scrapsToday.value += scraps.length
  }
})

// stats.insertsReceived - total inserts
// stats.updatesReceived - total updates
// stats.lastEventAt - timestamp of last event
```

### Pattern 4: Notifications

Show toasts for new scraps:

```javascript
onInsert: (scraps) => {
  scraps.forEach(scrap => {
    toast.success(\`New \${scrap.source} scrap added!\`)
  })
}
```

## 🔧 Advanced Usage

### Manual Connection Control

```javascript
const { connect, disconnect } = useRealtimeScraps({
  autoConnect: false  // Don't connect on mount
})

// Connect when user clicks a button
onButtonClick(() => {
  connect()
})

// Disconnect when leaving view
onBeforeUnmount(() => {
  disconnect()
})
```

### Disable Batching for Immediate Updates

```javascript
useRealtimeScraps({
  enableBatching: false,  // Process events immediately
  onInsert: (scraps) => {
    // scraps will always be a single-item array
  }
})
```

### Access Supabase Client Directly

```javascript
const { client } = useRealtimeScraps()

// Use for queries
const { data } = await client.value
  .from('scraps')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(10)
```

## 🚀 Performance Considerations

### Memory Management

The feed component limits display to 50 items:

```javascript
const MAX_FEED_SIZE = 50

recentScraps.value = [
  ...newScraps,
  ...recentScraps.value
].slice(0, MAX_FEED_SIZE)
```

Adjust based on your needs and available memory.

### Network Efficiency

- **Batching reduces UI thrashing**: Multiple rapid updates process together
- **Event queue prevents blocking**: UI remains responsive
- **Reconnection backoff**: Reduces server load during outages

### Browser Tab Visibility

Consider pausing subscriptions when tab is hidden:

```javascript
import { usePageVisibility } from '@vueuse/core'

const visibility = usePageVisibility()

watch(visibility, (current) => {
  if (current === 'visible') {
    connect()
  } else {
    disconnect()
  }
})
```

## 🐛 Troubleshooting

### "Missing Supabase credentials" Error

Check your `.env` file:
```bash
VITE_SUPABASE_URL=https://xmdylmbdeulxcqdbkfno.supabase.co
VITE_SUPABASE_KEY=your_actual_anon_key
```

Note: Environment variables must start with `VITE_` to be exposed to the client.

### No Events Received

1. Check Supabase Dashboard → Database → Replication
2. Ensure `scraps` table has Realtime enabled
3. Check browser console for WebSocket errors
4. Verify RLS policies allow reads for your key

### Events Delayed

This is normal! The default batch delay is 300ms. Adjust in the composable:

```javascript
const BATCH_DELAY_MS = 100  // Faster but more UI updates
```

### Connection Keeps Dropping

- Check network stability
- Verify Supabase project status
- Check browser console for specific errors
- Try increasing reconnection delays

## 📊 Statistics & Monitoring

The composable tracks useful metrics:

```javascript
const { stats } = useRealtimeScraps()

// Access in your component
console.log({
  insertsReceived: stats.value.insertsReceived,
  updatesReceived: stats.value.updatesReceived,
  errorsEncountered: stats.value.errorsEncountered,
  lastEventAt: stats.value.lastEventAt,
  connectionAttempts: stats.value.connectionAttempts
})
```

## 🎨 Styling Notes

The components use your existing cyberpunk aesthetic:

- **Primary Color**: `#00ff88` (neon green)
- **Background**: Dark with transparency
- **Borders**: Subtle green glow
- **Animations**: Smooth transitions (0.3s ease)
- **Typography**: System fonts for performance

## 🔮 Future Enhancements

Ideas for evolution:

1. **Filters**: Subscribe to specific sources or tags
2. **Search Integration**: Update results in real-time
3. **Virtual Scrolling**: Handle thousands of items
4. **Offline Queue**: Store events when disconnected
5. **Audio Notifications**: Chime on new scraps
6. **Desktop Notifications**: Browser notification API
7. **Analytics Dashboard**: Real-time charts and graphs
8. **Collaborative Features**: See other users' activity

## 🙏 Philosophy

This system embodies:

- **Ada's Vision**: Elegant patterns that scale
- **Sophie's Rigor**: Question assumptions, handle edge cases
- **Masham's Logic**: Reason over tradition, evidence over dogma

The batching system treats events like ingredients - let them marry together before serving. The reconnection logic embraces failure as temporary, always seeking to restore harmony.

---

*Blessed be the code, and blessed be the compiler.*
*May your scraps flow like water, your errors be few, and your dashboard forever live.*

**~ 🔮 SAGE**
*Kitchen Witch Hacker*
