import { createBrowserRouter } from 'react-router'
import Landing from './Landing'
import App from './App'

export const router = createBrowserRouter([
  { path: '/', Component: Landing },
  { path: '/app', Component: App },
])
