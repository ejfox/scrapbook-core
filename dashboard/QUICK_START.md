# Scrapbook Real-time Dashboard - Quick Start

*Get your real-time stream flowing in 5 minutes*

## 🚀 Speed Run Setup

```bash
# 1. Navigate to dashboard
cd /Users/ejfox/code/scrapbook-core/dashboard

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and add your Supabase anon key

# 4. Run development server
npm run dev
```

Visit `http://localhost:3002` - you should see scraps flowing in real-time!

## 📁 What Was Created

```
dashboard/
├── composables/
│   └── useRealtimeScraps.js     # ⭐ Core real-time logic
├── components/
│   └── ScrapsFeed.vue            # ⭐ Live feed component
├── App.vue                       # Main app
├── main.js                       # Vue initialization
├── package.json                  # Dependencies
├── vite.config.js                # Vite config
├── .env.example                  # Config template
├── REALTIME_SETUP.md            # Comprehensive docs
└── QUICK_START.md               # This file
```

## 🔑 Get Your Supabase Anon Key

1. Go to https://supabase.com/dashboard
2. Select your project
3. Settings → API
4. Copy the `anon` `public` key
5. Paste into `.env` file

## 🎯 Key Features

✅ **Real-time INSERT events** - New scraps appear instantly
✅ **Real-time UPDATE events** - Changes sync automatically
✅ **Intelligent batching** - Smooth performance, no UI thrashing
✅ **Auto-reconnection** - Exponential backoff, handles network issues
✅ **Error handling** - Graceful degradation with user feedback
✅ **Event queue** - Never miss an event, even during processing
✅ **Connection stats** - Monitor health and activity

## 🎨 Using the Composable in Your Components

```vue
<script setup>
import { useRealtimeScraps } from './composables/useRealtimeScraps'

const { isConnected, stats } = useRealtimeScraps({
  onInsert: (scraps) => console.log('New:', scraps),
  onUpdate: (updates) => console.log('Updated:', updates)
})
</script>

<template>
  <div>
    <p>Connection: {{ isConnected ? 'LIVE' : 'OFFLINE' }}</p>
    <p>Events received: {{ stats.insertsReceived }}</p>
  </div>
</template>
```

## 📡 How It Works

```
Supabase postgres_changes event
         ↓
useRealtimeScraps receives
         ↓
Event queued (300ms batch window)
         ↓
Batch processed → callback
         ↓
Your component updates
```

## ⚙️ Configuration Tunables

In `composables/useRealtimeScraps.js`:

```javascript
const BATCH_DELAY_MS = 300           // Batching window
const MAX_BATCH_SIZE = 50            // Events per batch
const RECONNECT_DELAY_MS = 1000      // Initial retry delay
const MAX_RECONNECT_DELAY_MS = 30000 // Max backoff
const RECONNECT_MULTIPLIER = 1.5     // Backoff growth rate
```

## 🎭 Common Patterns

### Live Feed (Default Implementation)
```vue
<ScrapsFeed />
```

### Custom Handler
```javascript
useRealtimeScraps({
  onInsert: (scraps) => {
    // Add to your data
    myData.value.push(...scraps)
  }
})
```

### Statistics Tracking
```javascript
const { stats } = useRealtimeScraps()
// stats.insertsReceived, stats.updatesReceived, etc.
```

### Manual Connection
```javascript
const { connect, disconnect } = useRealtimeScraps({
  autoConnect: false
})
// Call connect() when ready
```

## 🐛 Troubleshooting

**No events appearing?**
- Check `.env` has correct credentials
- Verify Supabase Realtime is enabled for `scraps` table
- Check browser console for errors

**Events delayed?**
- Normal! Default batch delay is 300ms
- Reduce `BATCH_DELAY_MS` for faster updates

**Connection dropping?**
- Check network stability
- Verify Supabase project status
- Review reconnection logs in console

## 📚 Documentation

- **REALTIME_SETUP.md** - Comprehensive guide with examples
- **useRealtimeScraps.js** - Inline code documentation
- **ScrapsFeed.vue** - Component usage example

## 🔮 Next Steps

1. ✅ Get basic real-time feed working
2. 🎨 Customize styling to match your aesthetic
3. 📊 Add statistics dashboard
4. 🔍 Integrate with search
5. 🔔 Add notifications for new scraps
6. 📱 Make responsive for mobile

---

**Need help?** Check REALTIME_SETUP.md for detailed explanations.

*Blessed be the stream, may your scraps flow eternal.*
