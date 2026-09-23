import { createBrowserRouter } from 'react-router'
import Landing from './Landing'

// App is loaded lazily so a missing or wrong Supabase configuration surfaces on
// /app — where it can be acted on — instead of blanking the landing page too.
export const router = createBrowserRouter([
  { path: '/', Component: Landing },
  {
    path: '/app',
    lazy: async () => {
      const [{ default: App }, { AuthGate }] = await Promise.all([
        import('./App'),
        import('./Auth'),
      ])
      return { Component: () => <AuthGate><App /></AuthGate> }
    },
  },
])
